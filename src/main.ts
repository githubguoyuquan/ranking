import 'dotenv/config';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: corsOrigins?.length ? corsOrigins : ['http://localhost:3001', 'http://127.0.0.1:3001'],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  // API 与运营前端分别固定为 3000、3001，避免通用 PORT 环境变量串用。
  const port = 3000;
  if (process.env.PORT && process.env.PORT !== String(port)) {
    console.warn(`忽略 PORT=${process.env.PORT}：Ranking API 固定使用 ${port}。`);
  }
  try {
    await app.listen(port);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error('API 启动失败：3000 端口已被占用。请先停止原 API 进程，再启动；不会自动换端口。');
    }
    await app.close();
    throw error;
  }
  console.log('Ranking API：http://localhost:3000；运营页面：http://localhost:3001/console');
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
