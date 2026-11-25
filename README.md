# pi-reccomendations

A structured question wizard for pi: the model offers multiple-choice questions, you answer with
numbered keys, answers come back as a structured tool result.

## Install

```bash
git clone https://github.com/trfar/pi-reccomendations.git ~/.pi/agent/extensions/pi-reccomendations
```

Register in `~/.pi/agent/settings.json`:

```json
{ "extensions": ["~/.pi/agent/extensions/pi-reccomendations/index.ts"] }
```

## Usage

The model will use the question wizard organically when it requires clarification.

To test, just ask in chat, e.g. "ask me which of three approaches I prefer". The wizard opens, one
question per screen.

Keys: `1`–`4` pick, arrows move, `Enter` confirms, a dim "Your Own Answer" row takes free text,
`Esc` cancels; a summary screen confirms at the end.

Works standalone in any session; under pi-plan-execute it's the PLAN-mode decision UI.
