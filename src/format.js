'use strict';

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatTimestamp(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds())
  ].join('');
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let size = value;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  const precision = index === 0 ? 0 : size < 10 ? 2 : 1;
  return `${size.toFixed(precision)} ${units[index]}`;
}

function formatDisplayTimestamp(value, locale = 'en') {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date).replace(',', '');
  } catch {
    return formatTimestamp(date);
  }
}

function formatBytesDisplay(bytes, locale = 'en') {
  const value = Number(bytes) || 0;
  const units = String(locale).toLowerCase().startsWith('zh')
    ? ['字节', 'KB', 'MB', 'GB', 'TB']
    : ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let size = value;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  const precision = index === 0 ? 0 : size < 10 ? 2 : 1;
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  });

  return `${formatter.format(size)} ${units[index]}`;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'backup';
}

module.exports = {
  formatBytes,
  formatBytesDisplay,
  formatDisplayTimestamp,
  formatTimestamp,
  slugify
};
