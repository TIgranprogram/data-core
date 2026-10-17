import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ImportTodo,
  ImportTodoSchema,
} from './import-todo.schema';
import { ImportTodoController } from './import-todo.controller';
import { ImportTodoService } from './import-todo.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ImportTodo.name, schema: ImportTodoSchema },
    ]),
  ],
  controllers: [ImportTodoController],
  providers: [ImportTodoService],
  exports: [ImportTodoService],
})
export class ImportTodoModule {}
