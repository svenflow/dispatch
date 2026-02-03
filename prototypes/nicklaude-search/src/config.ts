/**
 * Configuration management for nicklaude-search daemon.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import YAML from "yaml";

// =============================================================================
// Types
// =============================================================================

export type CategoryType = "append_only" | "mutable";

export interface CategoryConfig {
  path?: string;        // For file-based categories
  source?: string;      // For special sources (chat.db, contacts_notes)
  pattern?: string;     // Glob pattern for files
  type: CategoryType;
}

export interface SearchConfig {
  rerank: boolean;
  top_k: number;
}

export interface ServerConfig {
  port: number;
  host: string;
}

export interface Config {
  poll_interval: number;
  categories: Record<string, CategoryConfig>;
  search: SearchConfig;
  server: ServerConfig;
}

// =============================================================================
// Paths
// =============================================================================

const HOME = homedir();

export function getConfigDir(): string {
  return join(HOME, ".config", "nicklaude-search");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.yml");
}

export function getCacheDir(): string {
  return join(HOME, ".cache", "nicklaude-search");
}

export function getDbPath(): string {
  return join(getCacheDir(), "index.sqlite");
}

export function getModelsDir(): string {
  return join(getCacheDir(), "models");
}

// =============================================================================
// Default Configuration
// =============================================================================

export function getDefaultConfig(): Config {
  return {
    poll_interval: 5,
    categories: {
      transcripts: {
        path: join(HOME, "transcripts"),
        pattern: "**/*.jsonl",
        type: "append_only",
      },
      sms: {
        source: "chat.db",
        type: "append_only",
      },
      skills: {
        path: join(HOME, ".claude", "skills"),
        pattern: "**/*.md",
        type: "mutable",
      },
      contacts: {
        source: "contacts_notes",
        type: "mutable",
      },
      documents: {
        path: join(HOME, "Documents"),
        pattern: "**/*.{md,txt}",
        type: "mutable",
      },
    },
    search: {
      rerank: true,
      top_k: 20,
    },
    server: {
      port: 7890,
      host: "localhost",
    },
  };
}

// =============================================================================
// Load/Save Configuration
// =============================================================================

export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

export function ensureCacheDir(): void {
  const cacheDir = getCacheDir();
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  const modelsDir = getModelsDir();
  if (!existsSync(modelsDir)) {
    mkdirSync(modelsDir, { recursive: true });
  }
}

export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    // Create default config
    const defaultConfig = getDefaultConfig();
    saveConfig(defaultConfig);
    return defaultConfig;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const loaded = YAML.parse(content) as Partial<Config>;

    // Merge with defaults to ensure all fields exist
    const defaultConfig = getDefaultConfig();
    return {
      ...defaultConfig,
      ...loaded,
      categories: { ...defaultConfig.categories, ...loaded.categories },
      search: { ...defaultConfig.search, ...loaded.search },
      server: { ...defaultConfig.server, ...loaded.server },
    };
  } catch (error) {
    console.error(`Failed to parse config at ${configPath}: ${error}`);
    return getDefaultConfig();
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  const configPath = getConfigPath();

  const yaml = YAML.stringify(config, {
    indent: 2,
    lineWidth: 0,
  });

  writeFileSync(configPath, yaml, "utf-8");
}

// =============================================================================
// Resolve paths with ~ expansion
// =============================================================================

export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(HOME, path.slice(2));
  }
  if (path.startsWith("~")) {
    return join(HOME, path.slice(1));
  }
  return path;
}
