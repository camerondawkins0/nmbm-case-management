import { z } from "zod";

// Settings NMBM can change from the app, without a deploy. Each one is
// declared here with its default and its bounds, so the server, the
// admin page and the seed can't disagree about what's allowed.
export const APP_SETTINGS = {
  // R10: after a case closes, the last assigned worker keeps read
  // access for this long. NMBM: "they should still see them, especially
  // if they are the last assigned case manager. Cap it at 90 days and
  // make it adjustable." 90 is the ceiling, not only the default: the
  // administrator can shorten the window, never extend it.
  former_worker_access_days: {
    label: "Former case manager access (days)",
    description:
      "How long the last assigned worker can still open a client's record after the case closes. At most 90 days; 0 removes access at closure.",
    default: 90,
    min: 0,
    max: 90,
  },
} as const;

export type AppSettingKey = keyof typeof APP_SETTINGS;
export const APP_SETTING_KEYS = Object.keys(APP_SETTINGS) as AppSettingKey[];

export const appSettingUpdateSchema = z.object({
  value: z.number().int(),
});
export type AppSettingUpdate = z.infer<typeof appSettingUpdateSchema>;
