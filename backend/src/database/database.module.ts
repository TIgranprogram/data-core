import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { softDeletePlugin } from './soft-delete.plugin';
import { auditPlugin } from './audit.plugin';
import { userContextPlugin } from './user-context.plugin';
import { QuotationIndexHygieneMigration } from './migrations/2026-08-09-TZ-SALES-349-quotation-index-hygiene';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('nodeEnv') === 'production';
        return {
          uri: config.get<string>('mongo.uri'),
          dbName: config.get<string>('mongo.db'),
          replicaSet: config.get<string>('mongo.replicaSet'),
          autoIndex: !isProd,
          retryAttempts: 3,
          retryDelay: 1000,
          connectionFactory: (connection: Connection) => {
            // Apply global plugins (available to ALL schemas)
            connection.plugin(softDeletePlugin);
            connection.plugin(auditPlugin);
            connection.plugin(userContextPlugin);

            const logger = new Logger('MongoDB');
            connection.on('connected', () =>
              logger.log('Connected to MongoDB'),
            );
            connection.on('disconnected', () =>
              logger.warn('Disconnected from MongoDB'),
            );
            connection.on('reconnected', () =>
              logger.log('Reconnected to MongoDB'),
            );
            connection.on('error', (err: Error) =>
              logger.error(`MongoDB error: ${err.message}`, err.stack),
            );

            return connection;
          },
        };
      },
    }),
  ],
  providers: [QuotationIndexHygieneMigration],
  exports: [MongooseModule],
})
export class DatabaseModule {}
