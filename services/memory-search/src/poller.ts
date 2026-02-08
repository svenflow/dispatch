/**
 * File change detection via polling.
 *
 * Polls file mtimes at a configured interval to detect changes.
 * More reliable than fswatch for detecting new directories/files.
 */

import { existsSync, statSync, readdirSync } from "fs";
import { join } from "path";
import { Glob } from "bun";
import { CategoryConfig, Config, expandPath, loadConfig } from "./config";
import { Store } from "./store";
import {
  FileIndexer,
  TranscriptIndexer,
  SMSIndexer,
  ContactsIndexer,
  IndexResult,
} from "./indexer";

// =============================================================================
// Types
// =============================================================================

export interface PollResult {
  category: string;
  result: IndexResult;
  duration_ms: number;
}

export type PollCallback = (result: PollResult) => void;

// =============================================================================
// Poller
// =============================================================================

export class Poller {
  private store: Store;
  private config: Config;
  private fileIndexer: FileIndexer;
  private transcriptIndexer: TranscriptIndexer;
  private smsIndexer: SMSIndexer;
  private contactsIndexer: ContactsIndexer;

  private running: boolean = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private callback?: PollCallback;

  // Track last poll time per category
  private lastPollTime: Map<string, number> = new Map();

  constructor(store: Store, config?: Config) {
    this.store = store;
    this.config = config || loadConfig();
    this.fileIndexer = new FileIndexer(store);
    this.transcriptIndexer = new TranscriptIndexer(store);
    this.smsIndexer = new SMSIndexer(store);
    this.contactsIndexer = new ContactsIndexer(store);
  }

  /**
   * Set callback for poll results
   */
  onPoll(callback: PollCallback): void {
    this.callback = callback;
  }

  /**
   * Start polling
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll();
  }

  /**
   * Stop polling
   */
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Run a single poll cycle
   */
  async poll(): Promise<void> {
    if (!this.running) return;

    const categories = Object.entries(this.config.categories);

    for (const [category, catConfig] of categories) {
      const startTime = Date.now();

      try {
        let result: IndexResult;

        // Handle special sources
        if (catConfig.source === "chat.db") {
          result = await this.smsIndexer.indexSMS();
        } else if (catConfig.source === "contacts_notes") {
          result = await this.contactsIndexer.indexContacts();
        } else if (category === "transcripts") {
          result = await this.transcriptIndexer.indexTranscripts(catConfig.path!);
        } else if (catConfig.path) {
          result = await this.fileIndexer.indexCategory(category, catConfig);
        } else {
          continue;
        }

        const duration = Date.now() - startTime;

        // Only log/callback if there were changes
        if (result.added > 0 || result.updated > 0 || result.removed > 0 || result.errors.length > 0) {
          const pollResult: PollResult = {
            category,
            result,
            duration_ms: duration,
          };

          if (this.callback) {
            this.callback(pollResult);
          }
        }

        this.lastPollTime.set(category, Date.now());
      } catch (error) {
        console.error(`Error polling ${category}:`, error);
      }
    }

    // Schedule next poll
    if (this.running) {
      this.pollTimer = setTimeout(() => this.poll(), this.config.poll_interval * 1000);
    }
  }

  /**
   * Force immediate poll of a specific category
   */
  async pollCategory(category: string): Promise<IndexResult | null> {
    const catConfig = this.config.categories[category];
    if (!catConfig) return null;

    if (catConfig.source === "chat.db") {
      return this.smsIndexer.indexSMS();
    } else if (catConfig.source === "contacts_notes") {
      return this.contactsIndexer.indexContacts();
    } else if (category === "transcripts") {
      return this.transcriptIndexer.indexTranscripts(catConfig.path!);
    } else if (catConfig.path) {
      return this.fileIndexer.indexCategory(category, catConfig);
    }

    return null;
  }

  /**
   * Get last poll time for a category
   */
  getLastPollTime(category: string): number | undefined {
    return this.lastPollTime.get(category);
  }

  /**
   * Update config (e.g., after config file change)
   */
  updateConfig(config: Config): void {
    this.config = config;
  }
}
