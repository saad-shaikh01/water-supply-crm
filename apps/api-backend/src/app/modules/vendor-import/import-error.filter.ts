import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ImportError } from './import.types';

/** Renders `ImportError` as `{ statusCode, code, message }` — `code` is the stable machine value the UI keys on. */
@Catch(ImportError)
export class ImportErrorFilter implements ExceptionFilter {
  catch(exception: ImportError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(exception.status).json({ statusCode: exception.status, code: exception.code, message: exception.message });
  }
}
