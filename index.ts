/**
 * pi-reccomendations — structured question wizard.
 *
 * One job: the model calls `ask` with 1-6 questions (2-4 options each).
 * One question per screen; keys 1-4 pick, Enter confirms and advances,
 * Tab goes back (selection kept), Esc cancels. A final summary lists all
 * Q&As; Enter returns the structured answers to the model.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface AskQuestion {
	text: string;
	options: string[];
}

interface AskAnswer {
	question: string;
	selected: string;
}

interface AskDetails {
	questions: AskQuestion[];
	answers: AskAnswer[];
	cancelled?: boolean;
}

const QuestionSchema = Type.Object({
	text: Type.String({ description: "The question to ask" }),
	options: Type.Array(Type.String(), {
		minItems: 2,
		maxItems: 4,
		description:
			"2-4 short options the user can pick from. If you have a recommendation, make exactly one option your pick and end its text with ' (Reccomended)' (one space before the paren), e.g. 'Use a Postgres database (Reccomended)'.",
	}),
});

const AskParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		maxItems: 6,
		description: "1-6 questions, asked one per screen",
	}),
});

/** Runtime range checks with a clear per-question message. */
export function validateQuestions(questions: unknown): string | null {
	if (!Array.isArray(questions) || questions.length < 1 || questions.length > 6) {
		return "questions must be an array of 1-6 questions";
	}
	for (let i = 0; i < questions.length; i++) {
		const q = questions[i] as AskQuestion;
		if (!q || typeof q.text !== "string" || q.text.trim() === "") {
			return `question ${i + 1}: "text" must be a non-empty string`;
		}
		if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
			const n = Array.isArray(q.options) ? q.options.length : 0;
			return `question ${i + 1}: "options" must contain 2-4 options (got ${n})`;
		}
		if (q.options.some((o) => typeof o !== "string" || o.trim() === "")) {
			return `question ${i + 1}: every option must be a non-empty string`;
		}
	}
	return null;
}

export default function piRecommend(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask",
		label: "Ask",
		description:
			"Ask the user 1-6 multiple-choice questions (2-4 options each) in an interactive numbered-key wizard, ending with a summary the user confirms. Returns the selected option for each question. Use when the user must decide between concrete approaches, settings, or trade-offs. Each question also offers a final greyed-out 'Your Own Answer' option the user can select and type a custom response into. If you have a recommendation, end exactly one option's text with ' (Reccomended)' (one space before the paren).",
		parameters: AskParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const invalid = validateQuestions(params.questions);
			if (invalid) {
				return {
					content: [{ type: "text", text: `Invalid arguments: ${invalid}` }],
					details: { questions: params.questions, answers: [] } as AskDetails,
				};
			}

			if (ctx.mode !== "tui") {
				const list = params.questions
					.map((q, i) => `${i + 1}. ${q.text} (${q.options.join(" / ")})`)
					.join("\n");
				return {
					content: [
						{
							type: "text",
							text: `Error: the 'ask' wizard needs the interactive TUI, which is not available in this mode. Ask these questions in chat instead:\n${list}`,
						},
					],
					details: { questions: params.questions, answers: [] } as AskDetails,
				};
			}

			const answers = await ctx.ui.custom<AskAnswer[] | null>((tui, theme, _kb, done) => {
				let qIndex = 0;
				let screen: "question" | "summary" = "question";
				const selections = params.questions.map(() => 0); // per-question pick; kept when Tabbing back
				const customText = params.questions.map(() => ""); // per-question typed answer for the "Your Own Answer" row
				const answers: AskAnswer[] = [];
				let cachedLines: string[] | undefined;
				let cachedWidth = -1;

				function refresh() {
					cachedLines = undefined;
					tui.requestRender();
				}

				function handleInput(data: string) {
					if (matchesKey(data, Key.escape)) {
						// Esc in typing mode first clears the input; a second Esc cancels.
						if (screen === "question" && selections[qIndex] === params.questions[qIndex].options.length && customText[qIndex] !== "") {
							customText[qIndex] = "";
							refresh();
							return;
						}
						done(null);
						return;
					}
					if (screen === "summary") {
						if (matchesKey(data, Key.enter)) done(answers);
						return;
					}

					const opts = params.questions[qIndex].options;
					if (matchesKey(data, Key.backspace)) {
						if (selections[qIndex] === opts.length) {
							customText[qIndex] = customText[qIndex].slice(0, -1);
							refresh();
						}
						return;
					}
					if (selections[qIndex] === opts.length && data.length === 1 && data.charCodeAt(0) >= 32) {
						customText[qIndex] += data;
						refresh();
						return;
					}
					const digits = ["1", "2", "3", "4"] as const;
					for (const d of digits) {
						if (matchesKey(data, d) && Number(d) <= opts.length) {
							selections[qIndex] = Number(d) - 1;
							customText[qIndex] = ""; // picking a numbered option drops the typed text
							refresh();
							return;
						}
					}
					if (matchesKey(data, String(opts.length + 1))) {
						selections[qIndex] = opts.length; // the "Your Own Answer" row
						refresh();
						return;
					}
					if (matchesKey(data, Key.up)) {
						selections[qIndex] = (selections[qIndex] + opts.length) % (opts.length + 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.down)) {
						selections[qIndex] = (selections[qIndex] + 1) % (opts.length + 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.tab)) {
						if (qIndex > 0) {
							qIndex--;
							refresh();
						}
						return;
					}
					if (matchesKey(data, Key.enter)) {
						if (selections[qIndex] === opts.length && customText[qIndex].trim() === "") return; // empty typed answer: stay
						answers[qIndex] = {
							question: params.questions[qIndex].text,
							selected: selections[qIndex] === opts.length ? customText[qIndex].trim() : opts[selections[qIndex]],
						};
						if (qIndex === params.questions.length - 1) screen = "summary";
						else qIndex++;
						refresh();
					}
				}

				function render(width: number): string[] {
					const w = Math.max(1, width);
					if (cachedLines && cachedWidth === w) return cachedLines;
					const lines: string[] = [];

					function wrap(text: string, prefix: string) {
						const pw = visibleWidth(prefix);
						if (pw >= w) {
							lines.push(...wrapTextWithAnsi(text, w));
							return;
						}
						const wrapped = wrapTextWithAnsi(text, w - pw);
						for (let i = 0; i < wrapped.length; i++) {
							lines.push(`${i === 0 ? prefix : " ".repeat(pw)}${wrapped[i]}`);
						}
					}

					lines.push(theme.fg("accent", "─".repeat(w)));
					if (screen === "question") {
						const q = params.questions[qIndex];
						lines.push(theme.fg("muted", `Question ${qIndex + 1} of ${params.questions.length}`));
						lines.push("");
						wrap(theme.fg("text", q.text), " ");
						lines.push("");
						q.options.forEach((opt, i) => {
							const sel = i === selections[qIndex];
							wrap(theme.fg(sel ? "accent" : "text", `${i + 1}. ${opt}`), sel ? theme.fg("accent", "> ") : "  ");
						});
						if (selections[qIndex] === q.options.length) {
							wrap(
								theme.fg("dim", `${q.options.length + 1}. Your Own Answer: `) + theme.fg("text", customText[qIndex]) + theme.fg("dim", "▍"),
								theme.fg("accent", "> "),
							);
						} else {
							lines.push(theme.fg("dim", `  ${q.options.length + 1}. Your Own Answer`));
						}
						lines.push("");
						lines.push(
							theme.fg(
								"dim",
								selections[qIndex] === q.options.length
									? "type your answer • Enter confirm • Tab back • Esc clear/cancel"
									: `1-${q.options.length + 1} select • Enter confirm • Tab back • Esc cancel`,
							),
						);
					} else {
						lines.push(theme.fg("muted", `Answers (${answers.length})`));
						lines.push("");
						answers.forEach((a, i) => {
							wrap(theme.fg("text", `${i + 1}. ${a.question}`), " ");
							wrap(theme.fg("accent", `   → ${a.selected}`), " ");
							lines.push("");
						});
						lines.push(theme.fg("dim", "Enter to finish • Esc to cancel"));
					}
					lines.push(theme.fg("accent", "─".repeat(w)));
					cachedWidth = w;
					cachedLines = lines;
					return lines;
				}

				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
					},
					handleInput,
				};
			});

			if (answers === null) {
				return {
					content: [{ type: "text", text: "User cancelled the question wizard before finishing." }],
					details: { questions: params.questions, answers: [], cancelled: true } as AskDetails,
				};
			}

			const list = answers.map((a, i) => `${i + 1}. ${a.question}\n   → ${a.selected}`).join("\n");
			return {
				content: [{ type: "text", text: `User answered all questions:\n${list}` }],
				details: { questions: params.questions, answers } as AskDetails,
			};
		},

		renderCall(args, theme, _context) {
			const qs = Array.isArray(args?.questions) ? args.questions : [];
			let text =
				theme.fg("toolTitle", theme.bold("ask ")) +
				theme.fg("muted", `${qs.length} question${qs.length === 1 ? "" : "s"}`);
			for (let i = 0; i < qs.length; i++) {
				text += `\n${theme.fg("dim", `  ${i + 1}. ${qs[i]?.text ?? ""}`)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as AskDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.cancelled || details.answers.length === 0) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}
			let text = theme.fg("success", "✓ ");
			text += details.answers.map((a, i) => `${i + 1}. ${a.selected}`).join("\n  ");
			return new Text(text, 0, 0);
		},
	});

	// One-line nudge so the model offers choices via the wizard instead of prose —
	// matters most under pi-plan's PLAN persona, which otherwise pushes prose picks.
	pi.on("before_agent_start", async (event, ctx) => {
		if (event.messageType !== "user" || !ctx.hasUI) return;
		return {
			message: {
				customType: "pi-reccomendations-nudge",
				content:
					"When the user must pick between concrete options (approach, setting, trade-off), offer the choices with the ask tool — one decision per question — instead of asking in chat. Mark your recommended choice by ending that one option's text with ' (Reccomended)' (one space before the paren).",
				display: false,
			},
		};
	});
}
