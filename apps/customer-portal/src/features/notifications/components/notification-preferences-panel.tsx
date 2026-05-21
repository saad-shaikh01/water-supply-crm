'use client';

import {
  useNotificationPreferences,
  useUpsertPreference,
  PREFERENCE_EVENTS,
  PREFERENCE_CHANNELS,
} from '../hooks/use-notification-preferences';
import { Skeleton } from '@water-supply-crm/ui';
import { Bell } from 'lucide-react';

export function NotificationPreferencesPanel() {
  const { data: prefs, isLoading } = useNotificationPreferences();
  const { mutate: upsert } = useUpsertPreference();

  const isEnabled = (eventType: string, channel: string) => {
    if (!prefs) return true; // default: enabled
    const found = prefs.find((p) => p.eventType === eventType && p.channel === channel);
    return found ? found.enabled : true;
  };

  const toggle = (eventType: string, channel: string, current: boolean) => {
    upsert({ eventType, channel, enabled: !current });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Bell className="h-5 w-5 text-primary" />
        <h2 className="text-base font-bold">Notification Preferences</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Choose which notifications you want to receive for each channel.
      </p>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-border/50 overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-[1fr_repeat(2,60px)] gap-2 px-4 py-2 bg-white/5 border-b border-border/50">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Event</span>
            {PREFERENCE_CHANNELS.map((ch) => (
              <span key={ch.key} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-center">
                {ch.label}
              </span>
            ))}
          </div>

          {/* Event rows */}
          {PREFERENCE_EVENTS.map((event, idx) => (
            <div
              key={event.key}
              className={`grid grid-cols-[1fr_repeat(2,60px)] gap-2 px-4 py-3 items-center ${
                idx < PREFERENCE_EVENTS.length - 1 ? 'border-b border-border/30' : ''
              }`}
            >
              <span className="text-sm font-medium text-white">{event.label}</span>
              {PREFERENCE_CHANNELS.map((ch) => {
                const enabled = isEnabled(event.key, ch.key);
                return (
                  <div key={ch.key} className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => toggle(event.key, ch.key, enabled)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                        enabled ? 'bg-primary' : 'bg-white/20'
                      }`}
                      aria-label={`${enabled ? 'Disable' : 'Enable'} ${event.label} via ${ch.label}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                          enabled ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
