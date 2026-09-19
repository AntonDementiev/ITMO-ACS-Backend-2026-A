import { randomUUID } from 'crypto';
import { BaseEntity, Column, CreateDateColumn, DataSource, Entity, EntityManager, PrimaryColumn } from 'typeorm';

import { getClient, ServiceName } from './client';
import { isUniqueViolation } from './validators';

// Таблица outbox: событие пишется в той же транзакции, что и изменение данных,
// а отдельный процесс доставляет его получателям (сейчас по HTTP, в следующем ДЗ через RabbitMQ).
@Entity('outbox_events')
export class OutboxEvent extends BaseEntity {
    @PrimaryColumn({ type: 'uuid' }) id: string;
    @Column({ type: 'varchar', length: 100 }) type: string;
    @Column({ type: 'jsonb' }) payload: any;
    @CreateDateColumn() createdAt: Date;
    @Column({ type: 'timestamp', nullable: true }) publishedAt: Date | null;
    @Column({ type: 'int', default: 0 }) attempts: number;
    @Column({ type: 'timestamp' }) nextAttemptAt: Date;
}

// Таблица inbox: id обработанных событий (повторная доставка не выполняется дважды)
@Entity('inbox_events')
export class InboxEvent extends BaseEntity {
    @PrimaryColumn({ type: 'uuid' }) eventId: string;
    @CreateDateColumn() processedAt: Date;
}

export interface EventEnvelope { event_id: string; type: string; version: number; occurred_at: string; payload: any }

export const publishEvent = async (manager: EntityManager, type: string, payload: any) => {
    await manager.insert(OutboxEvent, { id: randomUUID(), type, payload, nextAttemptAt: new Date() });
};

let dispatcher: { run: () => Promise<void> } | undefined;
export const dispatchSoon = () => { if (dispatcher) setImmediate(() => dispatcher!.run().catch(() => undefined)); };

// routes: тип события -> сервисы-получатели
export function startOutboxDispatcher(ds: DataSource, routes: Record<string, ServiceName[]>, intervalMs = 2000) {
    let busy = false;
    const run = async () => {
        if (busy) return;
        busy = true;
        try {
            const repo = ds.getRepository(OutboxEvent);
            const list = await repo.createQueryBuilder('e').where('e.publishedAt IS NULL AND e.nextAttemptAt <= :now', { now: new Date() })
                .orderBy('e.createdAt', 'ASC').limit(50).getMany();
            for (const e of list) {
                const env: EventEnvelope = { event_id: e.id, type: e.type, version: 1, occurred_at: e.createdAt.toISOString(), payload: e.payload };
                try {
                    for (const target of routes[e.type] || []) await getClient().call(target, 'POST', '/internal/v1/events', { body: env, idempotent: true });
                    await repo.update(e.id, { publishedAt: new Date() });
                } catch (err: any) {
                    const attempts = e.attempts + 1;
                    await repo.update(e.id, { attempts, nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 60) * 1000) });
                    console.warn(`Событие ${e.type} (${e.id}) не доставлено, попытка ${attempts}: ${err?.code || err?.message}`);
                }
            }
        } finally { busy = false; }
    };
    dispatcher = { run };
    setInterval(() => run().catch(() => undefined), intervalMs);
}

// Обрабатывает событие один раз: id записывается в inbox в той же транзакции, что и результат.
export async function processOnce(ds: DataSource, eventId: string, fn: (m: EntityManager) => Promise<void>): Promise<boolean> {
    try {
        await ds.transaction(async (m) => {
            await m.insert(InboxEvent, { eventId });
            await fn(m);
        });
        return true;
    } catch (e) {
        if (isUniqueViolation(e)) return false;
        throw e;
    }
}
