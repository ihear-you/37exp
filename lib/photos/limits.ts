// Ограничения загрузки. Регистрация открытая, поэтому место на пользователя ограничено,
// иначе один человек может заполнить диск сервера. Меняются в .env.local.

const MIB = 1024 * 1024;

/** Самый большой один файл: MAX_FILE_MB, по умолчанию 40 МБ (кадр со сканера 5–6 МБ, TIFF больше) */
export const MAX_FILE_BYTES = Number(process.env.MAX_FILE_MB || 40) * MIB;

/** Всего оригиналов на одного пользователя: USER_QUOTA_GB, по умолчанию 10 ГБ (по брифу около 3 ГБ в год) */
export const USER_QUOTA_BYTES = Number(process.env.USER_QUOTA_GB || 10) * 1024 * MIB;

/** За один раз */
export const MAX_FRAMES_PER_UPLOAD = 2000;
