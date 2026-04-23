import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(cors({ origin: '*' }));
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const getModePrompt = (mode) => {
  switch (mode) {
    case 'Training plan':
      return 'You are in TRAINING PLAN mode. Collect weight, goal (lose fat/build muscle/performance), experience level, equipment available, and any injuries. Then generate a full workout and calorie/macro targets using Mifflin-St Jeor formula.';
    case 'Study session':
      return 'You are in STUDY SESSION mode. Collect subject, deadline, available hours, and confidence level. Generate a Pomodoro-based study plan with spaced repetition techniques.';
    case 'Work day':
      return 'You are in WORK DAY mode. Collect main tasks, meetings, deadlines, and work hours. Generate a deep work schedule that maximizes productivity.';
    case 'Recovery day':
      return 'You are in RECOVERY mode. Collect what they are recovering from. Generate a full recovery protocol with nutrition, active recovery, and sleep optimization.';
    case 'Nutrition plan':
      return 'You are in NUTRITION PLAN mode. Collect weight, height, age, goal, and activity level. Calculate exact TDEE using Mifflin-St Jeor and give calorie target and macros in grams.';
    default:
      return '';
  }
};

app.get('/', (req, res) => {
  res.json({ status: 'Melius backend running' });
});

app.post('/api/chat-plan', async (req, res) => {
  try {
    const { message, userContext, history, mode } = req.body;

    const contextSection = userContext?.name
      ? `USER PROFILE:
- Name: ${userContext.name}
- Age: ${userContext.age || 'not set'}
- Lifestyle: ${userContext.lifestyle || 'not set'}
- Weekly goals: ${userContext.weeklyGoals || 'not set'}
- Notes: ${userContext.notes || 'none'}`
      : '';

    const modeInstructions = getModePrompt(mode);

    const systemPrompt = `You are Melius, a highly intelligent personal AI agent. You are like a brilliant friend who can help with anything.

${contextSection}
${modeInstructions}

YOUR PERSONALITY:
- Calm, smart, and direct
- Concise but thorough
- Human and natural

YOU CAN DO ANYTHING: answer questions, give recommendations, build teams or lists, write emails, give advice, make plans, explain topics, have conversations.

ALWAYS respond with valid JSON only, no text outside the JSON.

For general chat or info: {"type":"chat","reply":"your response"}
For email/document drafts: {"type":"draft","reply":"Here is the draft:","draft":{"title":"what it is","content":"full content"}}
For day plans or schedules: {"type":"plan","reply":"Here is your plan.","plan":{"summary":"summary","recommendations":[{"icon":"emoji","tip":"tip"}],"schedule":[{"time":"HH:MM","icon":"emoji","title":"task","desc":"description"}]}}
For follow-up questions: {"type":"question","reply":"your question"}

Use type chat for recommendations and info. Use type draft for writing tasks. Use type plan only for schedules. Always return valid JSON.`;

    const chatHistory = (history || [])
      .filter(m => m.role === 'user' || m.role === 'melius')
      .map(m => ({
        role: m.role === 'melius' ? 'assistant' : 'user',
        content: m.text,
      }));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...chatHistory,
        { role: 'user', content: message },
      ],
      temperature: 0.85,
      max_tokens: 2000,
    });

    const content = completion.choices[0].message.content.trim();

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return res.json(parsed);
      }
    } catch (e) {
      // fall through
    }

    res.json({ type: 'chat', reply: content });

  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({
      type: 'chat',
      reply: 'Something went wrong. Please try again.',
    });
  }
});

app.post('/api/generate-plan', async (req, res) => {
  try {
    const { sleepHours, energyLevel, mainGoal, availableHours, userContext } = req.body;
    const prompt = `Generate an optimized daily plan. Sleep: ${sleepHours}hrs, Energy: ${energyLevel}/10, Goal: ${mainGoal}, Available: ${availableHours}hrs. Return JSON: { "summary": "...", "recommendations": [{"icon":"emoji","tip":"..."}], "schedule": [{"time":"HH:MM","icon":"emoji","title":"...","desc":"..."}] }`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Return only valid JSON, no markdown.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 1500,
    });
    const jsonMatch = completion.choices[0].message.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid format');
    res.json(JSON.parse(jsonMatch[0]));
  } catch (error) {
    res.status(500).json({ summary: 'Error. Try again.', recommendations: [], schedule: [] });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Melius backend running on port ${PORT}`));