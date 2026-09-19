import { jwksFromIdentity, startService } from '@jobsearch/common';
import { dataSource } from './db';
import NotificationController from './controllers/notification.controller';

startService({ name: 'notification-service', port: parseInt(process.env.PORT || '8007'), dataSource, jwks: jwksFromIdentity(), controllers: [NotificationController] });
