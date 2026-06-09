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
  })
  if (!res.ok) throw new Error(`LazurOS HTTP ${res.status}`)
  const data = await res.json()
  let parsed
  try { parsed = JSON.parse(data.response) } catch { throw new Error('LazurOS returned malformed JSON') }
  return validateAiResponse(parsed)
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
