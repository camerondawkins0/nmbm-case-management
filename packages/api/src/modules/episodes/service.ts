import type { Db } from "@nmbm/db";
import type { EpisodeCreate } from "@nmbm/shared";
import * as repository from "./repository.js";

export async function openEpisode(db: Db, input: EpisodeCreate) {
  return repository.insert(db, input);
}
