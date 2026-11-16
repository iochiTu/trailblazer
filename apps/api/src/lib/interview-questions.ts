import { type Db, onboardingQuestions, type Tx } from "@traiblazer/db";
import {
  type InterviewKind,
  type InterviewQuestion,
  type QuestionSetEntry,
  selectInterview,
} from "@traiblazer/industry-packs";
import { asc } from "drizzle-orm";

export type QuestionRow = typeof onboardingQuestions.$inferSelect;

export const toEntry = (row: QuestionRow): QuestionSetEntry => ({
  key: row.key,
  packs: row.packs,
  kind: row.kind as InterviewKind,
  question: row.question,
  hint: row.hint,
  options: row.options,
  sortOrder: row.sortOrder,
  enabled: row.enabled,
});

/** The whole question set staff keep in the operator console, in order. */
export async function questionSet(db: Db | Tx): Promise<QuestionRow[]> {
  return db
    .select()
    .from(onboardingQuestions)
    .orderBy(asc(onboardingQuestions.sortOrder), asc(onboardingQuestions.key));
}

/** The questions asked of a business in an industry (turned-off ones left out). */
export async function interviewFor(db: Db | Tx, pack: string): Promise<InterviewQuestion[]> {
  return selectInterview((await questionSet(db)).map(toEntry), pack);
}
