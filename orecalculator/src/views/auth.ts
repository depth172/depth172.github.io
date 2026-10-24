import { cloudEnabled, getStatus, getUserName } from '../core/cloud.ts';
import { esc } from './common.ts';

const STATUS_LABEL = { disabled: '', 'signed-out': '未ログイン', idle: '同期済み', syncing: '同期中...', error: '同期エラー' } as const;

export function renderAuth(): string {
  if (!cloudEnabled) return '';
  const st = getStatus();
  if (st === 'signed-out') return '<button data-a="login">Discordでログインして同期</button>';
  return `<span>${esc(getUserName())} - ${STATUS_LABEL[st]}</span><button data-a="logout">ログアウト</button>`;
}
