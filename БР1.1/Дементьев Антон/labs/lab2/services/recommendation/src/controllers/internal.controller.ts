import { IsIn, IsOptional } from 'class-validator';
import { Body, Get, JsonController, Param, Post, Res } from 'routing-controllers';
import { Response } from 'express';
import { In } from 'typeorm';
import { fail, isUuid, noContent, processOnce, EventEnvelope } from '@jobsearch/common';

import { dataSource } from '../db';
import { deleteResume, deleteVacancy, rebuild, upsertResume, upsertVacancy } from '../indexer';
import { IndexJob } from '../models/index.entities';

class RebuildDto { @IsOptional() @IsIn(['VACANCIES', 'RESUMES', 'ALL']) scope: string = 'ALL' }
const jobView = (j: IndexJob) => ({ job_id: j.id, scope: j.scope, status: j.status, processed_items: j.processedItems, started_at: j.startedAt, finished_at: j.finishedAt ?? null });

@JsonController('/internal/v1')
class InternalController {
    // Приём событий (пока по HTTP; в следующем ДЗ этот же обработчик подключится к RabbitMQ)
    @Post('/events')
    async events(@Body() env: EventEnvelope, @Res() res: Response) {
        await processOnce(dataSource, env.event_id, async (m) => {
            const p = env.payload;
            if (env.type === 'vacancy.upserted') await upsertVacancy(m, p);
            else if (env.type === 'vacancy.deleted') await deleteVacancy(m, p.vacancy_id);
            else if (env.type === 'resume.upserted') await upsertResume(m, p);
            else if (env.type === 'resume.deleted') await deleteResume(m, p.resume_id);
        });
        return noContent(res);
    }

    @Post('/index/rebuild')
    async rebuild(@Body({ type: RebuildDto }) body: RebuildDto, @Res() res: Response) {
        const repo = dataSource.getRepository(IndexJob);
        if (await repo.existsBy({ status: In(['QUEUED', 'RUNNING']) })) throw fail('INDEX_REBUILD_IN_PROGRESS');
        const job = await repo.save({ scope: body.scope, status: 'QUEUED' });
        rebuild(body.scope, job.id).catch(() => undefined);
        res.status(202).json(jobView(job));
        return res;
    }

    @Get('/index/rebuild/:jobId')
    async job(@Param('jobId') jobId: string) {
        const j = isUuid(jobId) ? await dataSource.getRepository(IndexJob).findOneBy({ id: jobId }) : null;
        if (!j) throw fail('JOB_NOT_FOUND');
        return jobView(j);
    }
}
export default InternalController;
