import { BadRequestException } from '@nestjs/common';

export function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${field} must be a non-empty string`);
  }
  return value;
}

export function requiredObject(body: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = body[field];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}
