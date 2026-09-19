import { IsEmail } from 'class-validator';
import { Body, Get, JsonController, Post, QueryParams, Res } from 'routing-controllers';
import { Response } from 'express';
import { fail, noContent, processOnce, EventEnvelope } from '@jobsearch/common';

import { dataSource } from '../db';
import { EmailLog } from '../models/email-log.entity';
import { findMails, MAIL_DEBUG, sendMail } from '../mailer';

class MailboxQuery { @IsEmail() email: string }

@JsonController('/internal/v1')
class NotificationController {
    // Приём событий (пока по HTTP; в следующем ДЗ этот же обработчик подключится к RabbitMQ)
    @Post('/events')
    async events(@Body() env: EventEnvelope, @Res() res: Response) {
        if (env?.type === 'identity.email_requested') {
            const p = env.payload;
            await processOnce(dataSource, env.event_id, async (m) => {
                sendMail(p.to_email, p.template, p.code, p.ttl_minutes);
                await m.insert(EmailLog, { toEmail: p.to_email, template: p.template, status: 'SENT', sentAt: new Date() });
            });
        }
        return noContent(res);
    }

    // ТОЛЬКО ДЛЯ ТЕСТОВ (MAIL_DEBUG=true): письма с кодом. Если письма ещё нет, ждёт его до 3 секунд.
    @Get('/dev/mailbox')
    async mailbox(@QueryParams({ type: MailboxQuery }) q: MailboxQuery) {
        if (!MAIL_DEBUG) throw fail('NOT_FOUND');
        for (let i = 0; i < 30; i++) {
            const items = findMails(q.email);
            if (items.length) return { items };
            await new Promise((r) => setTimeout(r, 100));
        }
        return { items: [] };
    }
}
export default NotificationController;
