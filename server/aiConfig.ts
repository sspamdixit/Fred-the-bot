import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { aiProviderConfigs } from "@shared/schema";

export const AI_PROVIDER_IDS = ["gemini", "groq", "hackclub"] as const;
export type AIProviderId = typeof AI_PROVIDER_IDS[number];

type ProviderDefinition = {
  id: AIProviderId;
  name: string;
  envKey: string;
  defaultPriority: number;
};

export type AIProviderStatus = {
  id: AIProviderId;
  name: string;
  enabled: boolean;
  priority: number;
  hasKey: boolean;
  keySource: "dashboard" | "environment" | "none";
};

export type AIProviderRuntime = AIProviderStatus & {
  apiKey: string | null;
};

const PROVIDERS: ProviderDefinition[] = [
  { id: "gemini", name: "Gemini", envKey: "GEMINI_API_KEY", defaultPriority: 1 },
  { id: "groq", name: "Groq", envKey: "GROQ_API_KEY", defaultPriority: 2 },
  { id: "hackclub", name: "Grok via Hack Club", envKey: "HACKCLUB_API_KEY", defaultPriority: 3 },
];

function getProviderDefinition(provider: AIProviderId): ProviderDefinition {
  const definition = PROVIDERS.find((item) => item.id === provider);
  if (!definition) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  return definition;
}

function getEncryptionKey(): Buffer {
  const dashboardPassword = process.env.DASHBOARD_PASSWORD;
  if (!dashboardPassword) {
    throw new Error("DASHBOARD_PASSWORD is required before dashboard-managed API keys can be stored.");
  }
  return createHash("sha256").update(dashboardPassword).digest();
}

function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

function decryptApiKey(encryptedApiKey: string): string | null {
  try {
    const [ivValue, tagValue, encryptedValue] = encryptedApiKey.split(".");
    if (!ivValue || !tagValue || !encryptedValue) {
      return null;
    }
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

async function getStoredConfigs() {
  return db.select().from(aiProviderConfigs);
}

export async function getAIProviderStatuses(): Promise<AIProviderStatus[]> {
  const configs = await getStoredConfigs();

  return PROVIDERS.map((definition) => {
    const config = configs.find((item) => item.provider === definition.id);
    const envKeyValue = process.env[definition.envKey] ?? "";
    const hasDashboardKey = !!config?.encryptedApiKey;
    const hasEnvironmentKey = !hasDashboardKey && (config?.enabled ?? true) && !!envKeyValue;
    const keySource = hasDashboardKey ? "dashboard" : hasEnvironmentKey ? "environment" : "none";

    return {
      id: definition.id,
      name: definition.name,
      enabled: config?.enabled ?? true,
      priority: config?.priority ?? definition.defaultPriority,
      hasKey: hasDashboardKey || hasEnvironmentKey,
      keySource,
    };
  }).sort((a, b) => a.priority - b.priority);
}

export async function getAIProviderRuntime(): Promise<AIProviderRuntime[]> {
  const configs = await getStoredConfigs();

  return PROVIDERS.map((definition) => {
    const config = configs.find((item) => item.provider === definition.id);
    const dashboardKey = config?.encryptedApiKey ? decryptApiKey(config.encryptedApiKey) : null;
    const environmentKey = !dashboardKey && (config?.enabled ?? true) ? (process.env[definition.envKey] ?? null) : null;
    const apiKey = dashboardKey || environmentKey;
    const keySource = dashboardKey ? "dashboard" : environmentKey ? "environment" : "none";

    return {
      id: definition.id,
      name: definition.name,
      enabled: config?.enabled ?? true,
      priority: config?.priority ?? definition.defaultPriority,
      hasKey: !!apiKey,
      keySource,
      apiKey,
    };
  }).sort((a, b) => a.priority - b.priority);
}

async function upsertProviderConfig(provider: AIProviderId, values: {
  encryptedApiKey?: string | null;
  enabled?: boolean;
  priority?: number;
}) {
  const definition = getProviderDefinition(provider);
  const existing = await db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.provider, provider)).limit(1);
  const current = existing[0];

  if (current) {
    const updateValues: Partial<typeof aiProviderConfigs.$inferInsert> = {
      updatedAt: new Date(),
    };
    if ("encryptedApiKey" in values) updateValues.encryptedApiKey = values.encryptedApiKey;
    if (typeof values.enabled === "boolean") updateValues.enabled = values.enabled;
    if (typeof values.priority === "number") updateValues.priority = values.priority;
    await db.update(aiProviderConfigs).set(updateValues).where(eq(aiProviderConfigs.provider, provider));
    return;
  }

  await db.insert(aiProviderConfigs).values({
    provider,
    encryptedApiKey: values.encryptedApiKey ?? null,
    enabled: values.enabled ?? true,
    priority: values.priority ?? definition.defaultPriority,
    updatedAt: new Date(),
  });
}

export async function setAIProviderEnabled(provider: AIProviderId, enabled: boolean): Promise<void> {
  await upsertProviderConfig(provider, { enabled });
}

export async function setAIProviderApiKey(provider: AIProviderId, apiKey: string): Promise<void> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error("API key cannot be empty.");
  }
  await upsertProviderConfig(provider, {
    encryptedApiKey: encryptApiKey(trimmedKey),
    enabled: true,
  });
}

export async function removeAIProviderApiKey(provider: AIProviderId): Promise<void> {
  await upsertProviderConfig(provider, {
    encryptedApiKey: null,
    enabled: false,
  });
}

export async function updateAIProviderOrder(providerIds: AIProviderId[]): Promise<void> {
  const uniqueProviders = [...new Set(providerIds)];
  if (uniqueProviders.length !== AI_PROVIDER_IDS.length || !AI_PROVIDER_IDS.every((provider) => uniqueProviders.includes(provider))) {
    throw new Error("Provider order must include gemini, groq, and hackclub exactly once.");
  }

  for (let index = 0; index < uniqueProviders.length; index++) {
    await upsertProviderConfig(uniqueProviders[index], { priority: index + 1 });
  }
}

export function isAIProviderId(value: string): value is AIProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}