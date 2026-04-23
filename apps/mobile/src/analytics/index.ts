/**
 * Analytics / crash reporting hook points. Replace with Sentry, Firebase, etc. for production.
 */
export function initMonitoring(): void {}

export function logScreenView(_name: string, _params?: Record<string, unknown>): void {}

export function logEvent(_name: string, _params?: Record<string, unknown>): void {}
