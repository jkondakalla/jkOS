const LESSON_PROMPT = (title, content, unit, courseTitle) => {
  const hasContent = content && content.trim().length > 30

  const contextLines = [
    courseTitle ? `Course: "${courseTitle}"` : '',
    unit        ? `Unit: "${unit}"`          : '',
    `Lecture: "${title}"`,
  ].filter(Boolean).join('\n')

  const contentSection = hasContent
    ? `Lecture notes:\n${content.trim().slice(0, 4000)}`
    : `(No lecture notes were extracted for this session. Generate questions and tasks based on the lecture title and the standard university curriculum for this topic.)`

  return `\
You are an educational assistant. Generate study material for the following lecture.

${contextLines}

${contentSection}

Respond with ONLY valid JSON in this exact format:
{
  "quiz": [
    {
      "question": "...",
      "options": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "explanation": "..."
    }
  ],
  "tasks": [
    {
      "description": "A concrete 2-minute practical task related to the lecture",
      "durationMinutes": 2
    }
  ]
}

Rules:
- Generate exactly 4 quiz questions
- Generate exactly 2 practical tasks
- Quiz questions should test conceptual understanding, not trivia
- Tasks should be actionable in ~2 minutes
- correctIndex is 0-based (0=A, 1=B, 2=C, 3=D)
- If no lecture notes are provided, infer from the lecture title what a standard university course on this topic would cover`
}

function mockContent(title) {
  return {
    quiz: [
      {
        question: `What is the main topic covered in "${title}"?`,
        options: ['The primary concept', 'A secondary concept', 'An unrelated topic', 'None of the above'],
        correctIndex: 0,
        explanation: 'This lecture primarily focuses on the core concept described in the title.',
      },
      {
        question: 'Which approach is described as most effective?',
        options: ['Theoretical analysis', 'Practical application', 'Historical review', 'Comparative study'],
        correctIndex: 1,
        explanation: 'Practical application is emphasised throughout the lecture material.',
      },
      {
        question: 'What prerequisite knowledge is assumed?',
        options: ['Advanced mathematics', 'Basic familiarity with the subject', 'No prior knowledge', 'Expert-level understanding'],
        correctIndex: 1,
        explanation: 'The lecture assumes basic familiarity with the subject area.',
      },
      {
        question: 'How should you apply what you learned?',
        options: ['Memorise the content', 'Practice with real examples', 'Read supplementary materials only', 'Skip to the next lecture'],
        correctIndex: 1,
        explanation: 'Active practice with real examples reinforces learning most effectively.',
      },
    ],
    tasks: [
      {
        description: `Write a 3-sentence summary of the key ideas from "${title}" in your own words.`,
        durationMinutes: 2,
      },
      {
        description: 'Identify one concept from this lecture you can apply today and write down how.',
        durationMinutes: 2,
      },
    ],
  }
}

function validateAiResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('AI response is not an object')
  if (!Array.isArray(parsed.quiz))  throw new Error('AI response missing quiz array')
  if (!Array.isArray(parsed.tasks)) throw new Error('AI response missing tasks array')
  for (const q of parsed.quiz) {
    if (!Array.isArray(q.options) || q.options.length === 0) throw new Error('Quiz question missing options')
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      throw new Error(`Quiz correctIndex ${q.correctIndex} out of range for ${q.options.length} options`)
    }
  }
  return parsed
}

// A hung provider would otherwise wedge the nightly job indefinitely
// (it holds the _nightlyRunning lock until every fetch settles).
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 120_000)

async function callOllama(url, model, title, content, unit, courseTitle) {
  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: LESSON_PROMPT(title, content, unit, courseTitle),
      stream: false,
      format: 'json',
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
  const data = await res.json()
  let parsed
  try { parsed = JSON.parse(data.response) } catch { throw new Error('Ollama returned malformed JSON') }
  return validateAiResponse(parsed)
}

async function callLazuros(url, token, model, title, content, unit, courseTitle) {
  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      model,
      prompt: LESSON_PROMPT(title, content, unit, courseTitle),
      stream: false,
      format: 'json',
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`LazurOS HTTP ${res.status}`)
  const data = await res.json()
  let parsed
  try { parsed = JSON.parse(data.response) } catch { throw new Error('LazurOS returned malformed JSON') }
  return validateAiResponse(parsed)
}

// ── Question stems (parameterized question templates) ───────────────────────

const STEM_PROMPT = (assignmentText, count, ctx = {}) => `\
You are an assessment designer for university-level courses. Below are the ACTUAL
problems from a course assignment. Distill each problem into a PARAMETERIZED
QUESTION STEM: keep the problem's setup, method and difficulty, but replace its
specific numbers/objects with variables — so many slightly-different versions of
the SAME problem can be generated, each practicing the same exercise.

Do NOT invent new exercises: every stem must be a direct parameterization of a
problem that appears in the assignment text.
${ctx.assignment ? `\nAssignment: "${ctx.assignment}"` : ''}${ctx.lecture ? `\nFrom session: "${ctx.lecture}"` : ''}${ctx.unit ? `\nUnit: "${ctx.unit}"` : ''}

Assignment problems:
${assignmentText.trim().slice(0, 6000)}

Respond with ONLY valid JSON in this exact format:
{
  "stems": [
    {
      "skill": "one line: what this exercise teaches",
      "stem": "Question text with placeholders, e.g. A car travels {{d}} km in {{t}} hours. What is its average speed in km/h?",
      "variables": [
        { "name": "d", "kind": "int", "min": 60, "max": 300, "step": 10 },
        { "name": "t", "kind": "float", "min": 1, "max": 4, "decimals": 1 },
        { "name": "u", "kind": "choice", "options": ["car", "train"] }
      ],
      "constraints": ["d % t != 0"],
      "answer": {
        "expression": "d / t",
        "decimals": 1,
        "distractors": ["t / d", "d * t", "d - t"],
        "explanation": "Average speed is distance over time: {{d}} / {{t}}."
      }
    }
  ]
}

Rules:
- Produce up to ${count} stems, one per distinct problem in the assignment (the
  clearest, most representative problems first). "skill" names what that problem teaches.
- Placeholders use {{name}} and every one must have a matching entry in "variables".
- "kind" is one of: "int" (min/max/optional step), "float" (min/max/decimals), "choice" (options).
- "constraints" (optional) are numeric conditions on variables (==, !=, <, <=, >, >=, %, arithmetic)
  used to keep sampled values sensible (e.g. avoid zero denominators, force non-trivial answers).
- "answer.expression" computes the correct numeric answer from the variables.
  Allowed: + - * / % ^ ( ) and abs, sqrt, round, floor, ceil, min, max, pow, log, exp, sin, cos, tan.
- "distractors" (optional, up to 3) are expressions for plausible WRONG answers that
  encode a specific mistake (inverted ratio, sign error, forgot to square, ...).
- "explanation" may use {{name}} placeholders and should teach the method, not just state the result.
- Choose variable ranges so the question stays realistic, stays close to the original
  problem's magnitudes, and keeps the arithmetic clean.
- If a problem is purely conceptual or proof-based (no computable answer), skip it.`

export async function generateQuestionStems(settings, assignmentText, count = 3, ctx = {}) {
  const { aiProvider, lazurosUrl, lazurosToken, ollamaUrl, ollamaModel } = settings
  const prompt = STEM_PROMPT(assignmentText, count, ctx)

  const tryProvider = async (fn) => {
    const data = await fn()
    let parsed
    try { parsed = JSON.parse(data.response) } catch { throw new Error('provider returned malformed JSON') }
    if (!Array.isArray(parsed?.stems)) throw new Error('provider response missing stems array')
    return parsed.stems
  }

  if (aiProvider === 'lazuros' && lazurosUrl) {
    try {
      return await tryProvider(() => postGenerate(lazurosUrl, lazurosToken ?? '', ollamaModel ?? 'llama3.2', prompt))
    } catch (e) {
      console.warn('[ai] LazurOS stem generation failed:', e.message)
    }
  }
  if (aiProvider === 'ollama' && ollamaUrl) {
    try {
      return await tryProvider(() => postGenerate(ollamaUrl, null, ollamaModel ?? 'llama3.2', prompt))
    } catch (e) {
      console.warn('[ai] Ollama stem generation failed:', e.message)
    }
  }
  // Unlike segment generation there is no useful mock for stems — surface the failure.
  throw Object.assign(new Error('no AI provider available for stem generation'), { status: 503 })
}

async function postGenerate(url, token, model, prompt) {
  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ model, prompt, stream: false, format: 'json' }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function generateSegmentContent(settings, lectureTitle, lectureContent, unit, courseTitle) {
  const { aiProvider, lazurosUrl, lazurosToken, ollamaUrl, ollamaModel } = settings

  if (aiProvider === 'lazuros' && lazurosUrl) {
    try {
      return await callLazuros(lazurosUrl, lazurosToken ?? '', ollamaModel ?? 'llama3.2', lectureTitle, lectureContent, unit, courseTitle)
    } catch (e) {
      console.warn(`[ai] LazurOS failed for "${lectureTitle}":`, e.message)
    }
  }

  if (aiProvider === 'ollama' && ollamaUrl) {
    try {
      return await callOllama(ollamaUrl, ollamaModel ?? 'llama3', lectureTitle, lectureContent, unit, courseTitle)
    } catch (e) {
      console.warn(`[ai] Ollama failed for "${lectureTitle}":`, e.message)
    }
  }

  return mockContent(lectureTitle)
}
