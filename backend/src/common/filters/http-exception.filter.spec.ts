import { ArgumentsHost, NotFoundException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import {
  HttpExceptionFilter,
  flattenValidationErrors,
  humanizeNotFoundMessage,
  humanizeValidationMessage,
} from './http-exception.filter';

describe('humanizeNotFoundMessage (TZ-UX-332)', () => {
  it('maps Product undefined not found to Russian with missing-id hint', () => {
    expect(humanizeNotFoundMessage('Product undefined not found')).toBe(
      'Изделие не найдено: не указан идентификатор',
    );
  });

  it('maps Product <ObjectId> not found to Изделие не найдено', () => {
    expect(humanizeNotFoundMessage('Product 64a1b2c3d4e5f678901234ab not found')).toBe(
      'Изделие не найдено',
    );
  });

  it('maps unknown entity tokens to Объект не найден', () => {
    expect(humanizeNotFoundMessage('Widget abc not found')).toBe('Объект не найден');
  });
});

describe('humanizeValidationMessage (TZ-NX-COMPOSITION-ERROR-I18N)', () => {
  // Every input string below is copy-pasted from a real 400 response
  // triggered live against this backend (POST /api/modules/:id/composition,
  // 2026-08-30) — not guessed class-validator wording. The old dictionary
  // matched constraint text against the decorator's camelCase name (e.g.
  // "ismongoid"), which never appears literally in class-validator's actual
  // generated sentences, so every one of these previously fell through to
  // the raw-English "Поле "x": ..." fallback.

  it('maps @IsMongoId() text to Russian (composition refId)', () => {
    expect(humanizeValidationMessage('refId must be a mongodb id')).toBe(
      'refId: Некорректный идентификатор MongoDB',
    );
  });

  it('maps @IsIn() text to Russian (composition lineType)', () => {
    expect(
      humanizeValidationMessage(
        'lineType must be one of the following values: module, material, product',
      ),
    ).toBe('lineType: Значение не входит в допустимый список');
  });

  it('maps the real combined @IsNumber()+@Min() message for composition quantity', () => {
    expect(
      humanizeValidationMessage(
        'quantity must not be less than 0.000001; quantity must be a number conforming to the specified constraints',
      ),
    ).toBe('quantity: Значение слишком мало; quantity: Должно быть числом');
  });

  it('falls back to the original text for a genuinely unknown constraint', () => {
    expect(humanizeValidationMessage('weight must be a positive widget-flavor')).toBe(
      'Поле "weight": weight must be a positive widget-flavor',
    );
  });
});

describe('flattenValidationErrors (TZ-BACKEND-VALIDATION-NESTED-I18N)', () => {
  it('flattens nested overrideDimensions.unit and humanizes its Length message', () => {
    const errors: ValidationError[] = [
      {
        property: 'overrideDimensions',
        children: [
          {
            property: 'unit',
            constraints: {
              isLength: 'unit must be longer than or equal to 1 characters',
            },
          },
        ],
      },
    ];

    expect(flattenValidationErrors(errors)).toEqual([
      'overrideDimensions.unit: Слишком короткое значение',
    ]);
  });

  it('keeps flat validation properties and multiple constraints intact', () => {
    const errors: ValidationError[] = [
      {
        property: 'quantity',
        constraints: {
          min: 'quantity must not be less than 0.000001',
          isNumber: 'quantity must be a number conforming to the specified constraints',
        },
      },
    ];

    expect(flattenValidationErrors(errors)).toEqual([
      'quantity: Значение слишком мало',
      'quantity: Должно быть числом',
    ]);
  });
});

describe('HttpExceptionFilter', () => {
  it('puts the Russian not-found phrase on the JSON body', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/products/undefined', method: 'PATCH' }),
      }),
    } as unknown as ArgumentsHost;

    new HttpExceptionFilter().catch(
      new NotFoundException('Product undefined not found'),
      host,
    );

    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0][0].message).toBe(
      'Изделие не найдено: не указан идентификатор',
    );
  });
});
