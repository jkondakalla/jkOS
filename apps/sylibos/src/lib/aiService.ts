import Anthropic from '@anthropic-ai/sdk'
import type { QuizQuestion, Task, AppSettings } from '../types'

// ── Course organisation ───────────────────────────────────────────────────────

export interface CourseUnit {
  name: string
  lectures: Array<{ filename: string; title: string }>
}

export interface CourseStructure {
  units: CourseUnit[]
}

const ORG_PROMPT = (pagesContext: string, pdfFiles: string[]) => `\
You are analysing a MIT OpenCourseWare course ZIP to produce a clean course structure.

COURSE NAVIGATION PAGES
Each page is shown as stripped plain text. Where a PDF download appears in the original HTML, it has been replaced with a [PDF:filename] marker so you can see the title that was written next to it.

${pagesContext}

ALL PDF FILENAMES PRESENT IN THE ZIP
${pdfFiles.join('\n')}

Return ONLY valid JSON. Include ONLY lecture / reading notes — exclude problem sets, exams, solutions, syllabi, and administrative files. Derive human-readable titles from the surrounding text, not from the raw filename.

{
  "units": [
    {
      "name": "Concise unit or section name",
      "lectures": [
        { "filename": "exact-filename-from-list-above.pdf", "title": "Human-readable title" }
      ]
    }
  ]
}`

function cleanFilenameTitle(filename: string): string {
  // Strip common MIT OCW prefix like "MIT18_01SCF10_" then humanise the rest
  const base = filename.replace(/\.pdf$/i, '')
  const noPrefix = base.replace(/^[A-Z]{1,5}\d{1,3}[_-]\w{4,12}[_-]/i, '')
  return noPrefix
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim() || base
}

function mockCourseStructure(pdfFiles: string[]): CourseStructure {
  return {
    units: [
      {
        name: 'Lectures',
        lectures: pdfFiles.map(f => ({ filename: f, title: cleanFilenameTitle(f) })),
      },
    ],
  }
}

async function orgViaOllama(
  url: string,
  model: string,
  pagesContext: string,
  pdfFiles: string[],
): Promise<CourseStructure> {
  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: ORG_PROMPT(pagesContext, pdfFiles),
      stream: false,
      format: 'json',
    }),
  })
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)
  const data = (await res.json()) as { response: string }
  try {
    return JSON.parse(data.response) as CourseStructure
  } catch {
    throw new Error('Ollama returned malformed JSON for course structure')
  }
}

async function orgViaLazuros(
  url: string,
  token: string,
  model: string,
  pagesContext: string,
  pdfFiles: string[],
): Promise<CourseStructure> {
  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      model,
      prompt: ORG_PROMPT(pagesContext, pdfFiles),
      stream: false,
      format: 'json',
    }),
  })
  if (!res.ok) throw new Error(`LazurOS error: ${res.status}`)
  const data = (await res.json()) as { response: string }
  try {
    return JSON.parse(data.response) as CourseStructure
  } catch {
    throw new Error('LazurOS returned malformed JSON for course structure')
  }
}

async function orgViaClaude(
  apiKey: string,
  pagesContext: string,
  pdfFiles: string[],
): Promise<CourseStructure> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: ORG_PROMPT(pagesContext, pdfFiles) }],
  })
  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON in Claude response')
  return JSON.parse(match[0]) as CourseStructure
}

export async function organizeCourse(
  pagesContext: string,
  pdfFiles: string[],
  settings: AppSettings,
): Promise<CourseStructure> {
  if (settings.aiProvider === 'lazuros' && settings.lazurosUrl) {
    try {
      return await orgViaLazuros(settings.lazurosUrl, settings.lazurosToken, settings.ollamaModel, pagesContext, pdfFiles)
    } catch {
      // fall through to mock
    }
  }
  if (settings.aiProvider === 'ollama') {
    try {
      return await orgViaOllama(settings.ollamaUrl, settings.ollamaModel, pagesContext, pdfFiles)
    } catch {
      // fall through to mock
    }
  }
  if (settings.aiProvider === 'claude' && settings.claudeApiKey) {
    try {
      return await orgViaClaude(settings.claudeApiKey, pagesContext, pdfFiles)
    } catch {
      // fall through to mock
    }
  }
  return mockCourseStructure(pdfFiles)
}

// ── Lesson content (quiz + tasks) ─────────────────────────────────────────────

export interface LessonContent {
  quiz: QuizQuestion[]
  tasks: Task[]
}

const LESSON_PROMPT = (title: string, content: string, unit?: string, courseTitle?: string) => {
  const contextLines = [
    courseTitle ? `Course: "${courseTitle}"` : '',
    unit        ? `Unit: "${unit}"`          : '',
    `Lecture: "${title}"`,
  ].filter(Boolean).join('\n')

  return `\
You are an educational assistant. Based on the following lecture content, generate a structured JSON response.

${contextLines}

Content:
${content.slice(0, 4000)}

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
- Quiz questions should test understanding, not trivia
- Tasks should be actionable in ~2 minutes
- correctIndex is 0-based (0=A, 1=B, 2=C, 3=D)`
}

async function callOllama(
  ollamaUrl: string,
  model: string,
  title: string,
  content: string,
  unit?: string,
  courseTitle?: string,
): Promise<LessonContent> {
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: LESSON_PROMPT(title, content, unit, courseTitle),
      stream: false,
      format: 'json',
    }),
  })
  if (!response.ok) throw new Error(`Ollama error: ${response.status}`)
  const data = (await response.json()) as { response: string }
  try {
    return JSON.parse(data.response) as LessonContent
  } catch {
    throw new Error('Ollama returned malformed JSON')
  }
}

async function callLazuros(
  lazurosUrl: string,
  token: string,
  model: string,
  title: string,
  content: string,
  unit?: string,
  courseTitle?: string,
): Promise<LessonContent> {
  const response = await fetch(`${lazurosUrl}/api/generate`, {
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
  if (!response.ok) throw new Error(`LazurOS error: ${response.status}`)
  const data = (await response.json()) as { response: string }
  try {
    return JSON.parse(data.response) as LessonContent
  } catch {
    throw new Error('LazurOS returned malformed JSON')
  }
}

async function callClaude(
  apiKey: string,
  title: string,
  content: string,
  unit?: string,
  courseTitle?: string,
): Promise<LessonContent> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: LESSON_PROMPT(title, content, unit, courseTitle) }],
  })
  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in Claude response')
  return JSON.parse(jsonMatch[0]) as LessonContent
}

function mockLessonContent(title: string): LessonContent {
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

export async function generateLessonContent(
  settings: AppSettings,
  lectureTitle: string,
  lectureContent: string,
  unit?: string,
  courseTitle?: string,
): Promise<LessonContent> {
  if (settings.aiProvider === 'lazuros' && settings.lazurosUrl) {
    try {
      return await callLazuros(settings.lazurosUrl, settings.lazurosToken, settings.ollamaModel, lectureTitle, lectureContent, unit, courseTitle)
    } catch { /* fall through to next provider */ }
  }
  if (settings.aiProvider === 'ollama') {
    try {
      return await callOllama(settings.ollamaUrl, settings.ollamaModel, lectureTitle, lectureContent, unit, courseTitle)
    } catch { /* fall through to mock */ }
  }
  if (settings.aiProvider === 'claude' && settings.claudeApiKey) {
    try {
      return await callClaude(settings.claudeApiKey, lectureTitle, lectureContent, unit, courseTitle)
    } catch { /* fall through to mock */ }
  }
  return mockLessonContent(lectureTitle)
}
