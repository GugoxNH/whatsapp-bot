// src/lib/posthog.js
import { PostHog } from 'posthog-node';

export const posthog = new PostHog(process.env.POSTHOG_SERVER_KEY, {
  host: process.env.POSTHOG_HOST || 'https://app.posthog.com',
});
