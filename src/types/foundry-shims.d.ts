// The upstream foundry-vtt-types package models Hooks/flags/Application options as closed,
// version-pinned unions. This module adds its own hook names, its own flag scope, and plain
// Application subclasses, none of which that package can know about ahead of time — so we
// widen just those seams here rather than fighting a third-party types package edit-by-edit.
export {};

declare global {
  type ApplicationOptions = Application.Options;

  interface HookConfig {
    [key: string]: (...args: any[]) => any;
  }

  interface FlagConfig {
    [key: string]: any;
  }
}
