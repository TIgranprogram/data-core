import { SchemaObjectFactory } from '@nestjs/swagger/dist/services/schema-object-factory';
import { ModelPropertiesAccessor } from '@nestjs/swagger/dist/services/model-properties-accessor';
import { SwaggerTypesMapper } from '@nestjs/swagger/dist/services/swagger-types-mapper';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

describe('C240 — реальная Swagger-схема команды сброса экранов', () => {
  it('PATCH публикует optional boolean только true; CREATE не принимает команду', () => {
    const schemas: Record<string, SchemaObject> = {};
    const factory = new SchemaObjectFactory(new ModelPropertiesAccessor(), new SwaggerTypesMapper());
    const update = schemas[factory.exploreModelSchema(UpdateRoleDto, schemas)];
    const create = schemas[factory.exploreModelSchema(CreateRoleDto, schemas)];
    const reset = update.properties!.resetStockViews as SchemaObject;
    // SchemaObjectFactory убирает верхний type у allOf; тип и единственное значение остаются внутри ограничения.
    expect(reset).not.toHaveProperty('type');
    expect(reset.allOf).toEqual([{ type: 'boolean', enum: [true] }]);
    expect(reset).not.toHaveProperty('enum'); // enum-helper Swagger ошибочно выводит number из верхнего enum[true].
    expect(update.required ?? []).not.toContain('resetStockViews');
    expect(create.properties).not.toHaveProperty('resetStockViews');
  });
});
