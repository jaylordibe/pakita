import './config/app-timezone';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import configuration from './config/configuration';
import { applyGlobalPrefix, buildOpenApiConfig } from './configure-http-app';

/**
 * Writes the API's OpenAPI document to `openapi.json` (this package's root),
 * the contract the desktop app's API types are generated from.
 *
 * Runs from the BUILD (`pnpm openapi:export`): the Nest CLI plugin that turns
 * DTO properties and their JSDoc into schema exists only in `nest build`.
 * Preview mode builds the route table without instantiating providers, so no
 * database, Redis or provider is contacted. The environment is the test one
 * (`.env.test`, loaded by the script), so the document is the same on every
 * machine.
 */
async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });
  applyGlobalPrefix(app);
  const document = SwaggerModule.createDocument(
    app,
    // Preview mode instantiates no provider, so read the same configuration
    // factory ConfigModule uses rather than ConfigService.
    buildOpenApiConfig(configuration()),
  );
  const outputPath = resolve(__dirname, '../openapi.json');
  writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}

void exportOpenApi();
