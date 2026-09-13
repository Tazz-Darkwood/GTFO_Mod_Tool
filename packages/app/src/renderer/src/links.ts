import { api } from './api';

export const KOFI_URL = 'https://ko-fi.com/tazzdarkwood';
export const REPO_URL = 'https://github.com/Tazz-Darkwood/GTFO_Mod_Tool';

export function openUrl(url: string): void {
  void api.invoke('app:openUrl', url);
}
