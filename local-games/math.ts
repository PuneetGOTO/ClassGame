import { plugin, rng, shuffled, type PluginFactory } from "../packages/game-sdk";
import type { Prompt } from "../packages/shared/protocol";
import { tierValue, type Difficulty } from "../packages/shared/route";

export interface Question extends Prompt { solution: string }
type Random = ReturnType<typeof rng>;
type QuestionFactory = (random: Random, index: number, tier?: Difficulty) => Omit<Question, "id">;
type Feedback = "correct" | "incorrect";
interface Answers {
  questions: Question[]; attempted: number; correct: number; lastQuestion: number; feedback?: Feedback;
}
interface QuizState { byPlayer: Record<string, Answers>; slot: number; hits: number }
interface QuizConfig {
  target: number; count: number; generate: QuestionFactory; synchronized?: boolean; mustAnswerAll?: boolean;
  retryWrong?: boolean; brickTarget?: number; validate?: (question: Question, answer: string) => boolean;
  course?: (tier: Difficulty) => Partial<QuizConfig>;
}

export const shuffle = shuffled;
export const options = (values: number[]) => values.map(value => ({ label: String(value), value: String(value) }));

/** Arithmetic construction based on hajunho/zeli-web-games MathChallenge (Apache-2.0).
 *  Adapted to injected randomness, exact integer division, and unbiased distractor order.
 */
export const arithmetic: QuestionFactory = (random, index, tier) => {
  const kind = (random(4) + index) % 4;
  const a = 4 + random(tier ? tierValue(tier, [9, 15, 27, 40]) : 13);
  const b = 2 + random(tier ? tierValue(tier, [7, 10, 12, 16]) : 10);
  const pairs: [string, number][] = [
    [a + " + " + b, a + b], [Math.max(a, b) + " − " + Math.min(a, b), Math.abs(a - b)],
    [a + " × " + b, a * b], [a * b + " ÷ " + b, a]
  ];
  const [base, answer] = pairs[kind];
  const extra = tier === 4 && index % 2 === 0 ? 2 + random(13) : 0;
  const text = extra ? "(" + base + ") + " + extra : base;
  const solution = answer + extra;
  const distractors = shuffle([1, 2, 3, 4, 5, 7].map(delta => solution + delta)
    .concat([1, 2, 3, 4, 5].map(delta => solution - delta).filter(n => n >= 0)), random).slice(0, 3);
  return { text, solution: String(solution), options: options(shuffle([solution, ...distractors], random)) };
};

export function quiz(config: QuizConfig): PluginFactory {
  return (context, saved) => quizEngine({
    ...config,
    ...(context.tier && config.course?.(context.tier))
  }, context.tier)(context, saved);
}

function quizEngine(config: QuizConfig, tier?: Difficulty) {
  const { target, count, generate, synchronized, mustAnswerAll, retryWrong, brickTarget, validate } = config;
  const all = (state: QuizState) => Object.values(state.byPlayer);
  const won = (state: QuizState, id: string) => {
    const answers = state.byPlayer[id];
    if (!answers || answers.correct < target) return false;
    if (brickTarget) return state.hits >= brickTarget;
    return !mustAnswerAll || answers.attempted >= count;
  };
  const current = (state: QuizState, player: Answers) => synchronized
    ? (player.lastQuestion === state.slot ? undefined : player.questions[state.slot])
    : player.questions[retryWrong ? player.correct : player.attempted];
  return plugin<QuizState>({
    init(context) {
      const byPlayer = Object.fromEntries(context.playerIds.map((id, index) => {
        const random = rng(context.seed ^ (synchronized ? 0 : Math.imul(index + 1, 0x9e3779b9)));
        const questions = Array.from({ length: count }, (_, i) => ({ ...generate(random, i, tier), id: i + 1 }));
        return [id, { questions, attempted: 0, correct: 0, lastQuestion: -1 }];
      }));
      return { byPlayer, slot: 0, hits: 0 };
    },
    tick: synchronized ? (state, frame) => {
      const slot = Math.min(count, Math.floor(frame.elapsed / (60_000 / count)));
      if (slot === state.slot) return false;
      state.slot = slot;
      for (const player of all(state)) player.feedback = undefined;
      return true;
    } : undefined,
    handleInput(state, id, input) {
      const player = state.byPlayer[id];
      if (input.kind !== "answer" || !player || (!synchronized && won(state, id) && !brickTarget)) return false;
      const question = current(state, player);
      if (!question || question.id !== input.questionId) return false;
      if (question.options && !question.options.some(option => option.value === input.value)) return false;
      const correct = validate ? validate(question, input.value) : question.solution === input.value;
      player.attempted++;
      player.lastQuestion = state.slot;
      player.feedback = correct ? "correct" : "incorrect";
      if (correct) {
        player.correct++;
        state.hits++;
      }
      return true;
    },
    getState(state, viewer) {
      const answers = viewer ? state.byPlayer[viewer] : undefined;
      const first = all(state)[0];
      const question = synchronized && !viewer ? first?.questions[state.slot]
        : answers ? current(state, answers) : all(state).map(player => current(state, player)).find(Boolean);
      const prompt: Prompt | undefined = question && {
        id: question.id, text: question.text,
        ...(question.numbers && { numbers: question.numbers }),
        ...(question.options && { options: question.options })
      };
      const stats = answers ?? (all(state).length === 1 ? first : undefined);
      return { kind: "quiz", ...(prompt && { prompt }),
        attempted: stats?.attempted ?? all(state).reduce((sum, item) => sum + item.attempted, 0),
        correct: stats?.correct ?? state.hits, ...(stats?.feedback && { feedback: stats.feedback }),
        ...(brickTarget && { bricks: Math.max(0, brickTarget - state.hits), brickTotal: brickTarget }) };
    },
    getProgress(state, viewer) {
      if (brickTarget) return { label: "擊碎磚塊", value: Math.min(brickTarget, state.hits), target: brickTarget };
      if (state.byPlayer[viewer ?? ""] || all(state).length === 1) {
        const player = state.byPlayer[viewer ?? ""] ?? all(state)[0];
        return { label: "答對題數", value: player.correct, target };
      }
      return { label: "達標隊員", value: Object.keys(state.byPlayer).filter(id => won(state, id)).length, target: all(state).length };
    },
    checkWin: won,
    isComplete(state) {
      if (synchronized) return false;
      return Object.keys(state.byPlayer).every(id => won(state, id))
        || (!retryWrong && all(state).every(player => player.attempted >= count));
    }
  });
}

