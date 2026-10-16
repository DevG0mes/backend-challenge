import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/** Extension point for external OIDC/JWT provider authentication. */
@Injectable()
export class ProviderAuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
