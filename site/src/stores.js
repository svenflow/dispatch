import { writable } from 'svelte/store';

export const currentPage = writable('home');

export function navigateTo(page) {
  console.log('navigateTo:', page);
  currentPage.set(page);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
