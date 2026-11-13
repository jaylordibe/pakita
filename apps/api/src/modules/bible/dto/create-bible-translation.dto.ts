import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateBibleTranslationDto {
  /** Short and unique, upper-case letters and digits, e.g. "WEB". */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9]{2,12}$/, {
    message: 'code must be 2–12 letters or digits',
  })
  code!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** BCP 47 language tag, e.g. "en", "tl", "pt-BR". */
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, {
    message: 'languageCode must be a BCP 47 tag such as "en" or "pt-BR"',
  })
  languageCode!: string;

  /** The terms the text is used under, as its publisher states them. */
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  licence!: string;

  /** Shown with every passage presented from this translation. */
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  attribution!: string;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(500)
  sourceUrl?: string;
}
