export interface Course {
  id: string
  title: string
  description: string
  instructor: string
  subject: string
  level: string
  importedAt: number
  lectures: Lecture[]
  completedSegments: number
}

export interface Lecture {
  id: string
  courseId: string
  title: string
  unit: string
  section?: string
  order: number
  content: string
  videoUrl?: string
  hasSegment: boolean
  segmentId?: string
}

export interface Segment {
  id: string
  lectureId: string
  courseId: string
  lectureTitle: string
  courseTitle: string
  unit: string
  section?: string
  generatedAt: number
  quiz: QuizQuestion[]
  tasks: Task[]
  completedAt?: number
  quizScore?: number
}

export interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
  explanation: string
}

export interface Task {
  description: string
  durationMinutes: number
}

export interface DailyLog {
  date: string // YYYY-MM-DD
  segmentIds: string[]
}

export type SchemeId = 'reading-room' | 'sandstone' | 'nocturne' | 'velvet'

export interface AppSettings {
  dailyGoal: number
  ollamaUrl: string
  ollamaModel: string
  claudeApiKey: string
  lazurosUrl: string
  lazurosToken: string
  aiProvider: 'lazuros' | 'ollama' | 'claude' | 'none'
  theme: 'dark' | 'light'
  scheme: SchemeId
}

export type AIProvider = 'lazuros' | 'ollama' | 'claude' | 'none'
