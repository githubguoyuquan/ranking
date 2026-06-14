import {
  Body,
  Controller,
  Get,
  Headers,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PublicRoute } from '../compliance/api-key.guard';
import { toPlainJson } from '../lib/json';
import { SiteService } from './site.service';

class SitePreferencesBodyDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recentTopics?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  watchlist?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(32)
  tier?: string;
}

class PersonalizedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  limit?: number;
}

function deviceIdFromHeaders(headers: Record<string, string | undefined>): string {
  const raw = headers['x-device-id']?.trim();
  if (!raw || raw.length > 64) {
    throw new UnauthorizedException('X-Device-Id header required (max 64 chars)');
  }
  return raw;
}

/** C 端匿名偏好与个性化（无密码登录；设备 ID 识别） */
@PublicRoute()
@Controller('v1/site')
export class SiteController {
  constructor(private readonly site: SiteService) {}

  @Get('profile')
  async getProfile(@Headers('x-device-id') deviceId?: string) {
    if (!deviceId?.trim()) {
      return toPlainJson({ tier: 'free', recentTopics: [], watchlist: [], anonymous: true });
    }
    return toPlainJson(await this.site.getProfile(deviceId));
  }

  @Put('profile')
  async putProfile(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: SitePreferencesBodyDto,
  ) {
    const deviceId = deviceIdFromHeaders(headers);
    return toPlainJson(await this.site.upsertProfile(deviceId, body));
  }

  @Get('personalized/topics')
  async personalizedTopics(
    @Headers('x-device-id') deviceId: string | undefined,
    @Query() query: PersonalizedQueryDto,
  ) {
    if (!deviceId?.trim()) {
      return toPlainJson({ slugs: [], source: 'anonymous' });
    }
    const slugs = await this.site.personalizedTopicSlugs(deviceId, query.limit ?? 6);
    return toPlainJson({ slugs, source: 'device_profile', count: slugs.length });
  }
}
