import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SignInDeviceTokenService } from './sign-in-device-token.service';
import { SignInFailureLimitService } from './sign-in-failure-limit.service';
import { JWT_ALGORITHM } from './jwt-algorithm';
import { RefreshTokenRetentionHandler } from './refresh-token-retention.handler';
import { RefreshTokenService } from './refresh-token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        const serviceName = configService.getOrThrow<string>('serviceName');
        return {
          secret: configService.getOrThrow<string>('jwt.secret'),
          signOptions: {
            expiresIn: configService.getOrThrow<string>(
              'jwt.expiresIn',
            ) as unknown as number,
            // Bind tokens to this service so they can't be replayed against
            // any other service that happens to share the same JWT_SECRET.
            issuer: serviceName,
            audience: serviceName,
            algorithm: JWT_ALGORITHM,
          },
          // Merged under every `JwtService.verify` call's own options (a
          // call's own value wins), so a verify that passes none still refuses
          // a token signed by another service or under another algorithm.
          // passport-jwt never reads these: JwtStrategy pins its own.
          verifyOptions: {
            issuer: serviceName,
            audience: serviceName,
            algorithms: [JWT_ALGORITHM],
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    RefreshTokenService,
    SignInFailureLimitService,
    SignInDeviceTokenService,
    // A BullMQ job handler, not a scheduled service. `QueueJobHandlerRegistry`
    // discovers it through this registration and fails the boot if the job it
    // claims has no entry in JOB_REGISTRATIONS (or vice versa).
    RefreshTokenRetentionHandler,
  ],
  // Re-export JwtModule so the app-wide `UserAwareThrottlerGuard` can read an
  // access token with the one JWT config, rather than re-registering it.
  // `RefreshTokenService` is exported so `UsersService` can end every session
  // an account holds — used by the support session-revocation endpoint and by
  // account deactivation. Sessions are auth's concern, so the capability lives
  // here and is borrowed, rather than re-implemented against the table.
  exports: [
    AuthService,
    RefreshTokenService,
    SignInFailureLimitService,
    JwtModule,
  ],
})
export class AuthModule {}
