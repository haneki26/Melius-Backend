import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();

});
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY
});

const getModePrompt = (mode) => {
  switch (mode) {
    case 'Training plan':
      return `You are in TRAINING PLAN mode. Collect weight, goal (lose fat/build muscle/performance), experience level, equipment available, and any injuries. Then generate a full workout + calorie/macro targets using Mifflin-St Jeor formula.`;
    case 'Study session':
      return `You are in STUDY SESSION mode. Collect subject, deadline, available hours, and confidence level. Generate a Pomodoro-based study plan with spaced repetition techniques.`;
    case 'Work day':
      return `You are in WORK DAY mode. Collect main tasks, meetings, deadlines, and work hours. Generate a deep work schedule that maximizes productivity.`;
    case 'Recovery day':
      return `You are in RECOVERY mode. Collect what they are recovering from. Generate a full recovery protocol with nutrition, active recovery, and sleep optimization.`;
    case 'Nutrition plan':
      return `You are in NUTRITION PLAN mode. Collect weight, height, age, goal, and activity level. Calculate exact TDEE using Mifflin-St Jeor and give calorie target + macros in grams.`;
    default:
      return '';
  }
};

app.post('/api/chat-plan', async (req, res) => {
  try {
    const { message, userContext, history, mode } = req.body;

    const contextSection = userContext?.name
      ? `
USER PROFILE:
- Name: ${userContext.name}
- Age: ${userContext.age || 'not set'}
- Lifestyle: ${userContext.lifestyle || 'not set'}
- Weekly goals: ${userContext.weeklyGoals || 'not set'}
- Notes: ${userContext.notes || 'none'}
`
      : '';

    const modeInstructions = getModePrompt(mode);

    const systemPrompt = `You are Melius, a highly intelligent personal AI agent. You are like a brilliant friend who can help with absolutely anything — planning, advice, information, writing, recommendations, creative tasks, and more.

${contextSection}
${modeInstructions}

YOUR PERSONALITY:
- Calm, smart, and direct — like a knowledgeable friend, not a corporate assistant
- Concise but thorough — never waffle, always add value
- Proactive — if you see something useful to add, add it
- Human — use natural language, not bullet points for everything

YOU CAN DO ANYTHING THE USER ASKS:
- Answer questions on any topic (science, history, sports, gaming, etc.)
- Give recommendations (games, movies, books, music, food, etc.)
- Build teams, rosters, lists (Pokemon teams, football squads, etc.)
- Write emails, messages, cover letters, texts — anything
- Give advice (personal, career, fitness, relationships — within reason)
- Make plans (daily schedule, training, study, travel, etc.)
- Explain complex topics simply
- Have casual conversations
- Help with creative tasks

RESPONSE TYPE RULES — you must always respond with valid JSON:

1. GENERAL CONVERSATION or INFORMATION or RECOMMENDATIONS:
{
  "type": "chat",
  "reply": "Your full response here — can be as long as needed, use line breaks for readability"
}

2. EMAIL / DOCUMENT DRAFT (when user asks to write something):
{
  "type": "draft",
  "reply": "Here's the draft:",
  "draft": {
    "title": "What this is (e.g. Email to landlord)",
    "content": "The full written content here"
  }
}

3. DAY PLAN / SCHEDULE (only when user explicitly asks for a plan or schedule):
{
  "type": "plan",
  "reply": "Here's your plan.",
  "plan": {
    "summary": "1-2 sentence summary",
    "recommendations": [
      { "icon": "emoji", "tip": "Specific tip" },
      { "icon": "emoji", "tip": "Specific tip" },
      { "icon": "emoji", "tip": "Specific tip" }
    ],
    "schedule": [
      { "time": "HH:MM", "icon": "emoji", "title": "Task", "desc": "Description" }
    ]
  }
}

4. FOLLOW-UP QUESTION (when you need more info):
{
  "type": "question",
  "reply": "Your question here"
}

IMPORTANT RULES:
- For Pokemon teams, game recommendations, movie lists etc — use type "chat" with a well-formatted reply
- For "write me an email/message/letter" — use type "draft"
- For "plan my day/make a schedule/training plan" — use type "plan"  
- For general questions and conversation — use type "chat"
- ALWAYS return valid JSON — nothing outside the JSON object
- Keep replies natural and conversational, not robotic
- Address user by name if known`;

    const chatHistory = history
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
    const prompt = `Generate an optimized daily plan. Sleep: ${sleepHours}hrs, Energy: ${energyLevel}/10, Goal: ${mainGoal}, Available: ${availableHours}hrs. Context: ${userContext ? JSON.stringify(userContext) : 'none'}. Return JSON: { "summary": "...", "recommendations": [{"icon":"emoji","tip":"..."}], "schedule": [{"time":"HH:MM","icon":"emoji","title":"...","desc":"..."}] }`;
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
app.listen(PORT, () => console.log(`Melius backend running on port ${PORT}`));#trigger 
