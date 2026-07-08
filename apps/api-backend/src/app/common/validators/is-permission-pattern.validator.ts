import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { isPermissionPattern } from '@water-supply-crm/authz';

/**
 * Validates that a value is a permission from the frozen catalog, or a valid wildcard
 * (`*` / `resource:*`). Use `{ each: true }` to validate every item of a string[].
 */
export function IsPermissionPattern(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPermissionPattern',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return isPermissionPattern(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} contains an invalid permission: "${String(args.value)}"`;
        },
      },
    });
  };
}
