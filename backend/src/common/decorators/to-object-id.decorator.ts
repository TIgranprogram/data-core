import { Transform } from 'class-transformer';
import { Types } from 'mongoose';

function convertToObjectId(value: unknown): unknown {
  if (!value) return value;
  if (Array.isArray(value)) {
    return value.map(convertToObjectId);
  }
  if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
    return new Types.ObjectId(value);
  }
  return value;
}

export function ToObjectId() {
  return Transform(({ value }) => convertToObjectId(value));
}
