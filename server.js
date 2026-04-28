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
app.use(express.json({ limit: '25mb' }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── WEB SEARCH via Brave ──
const webSearch = async (query) => {
  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&text_decorations=false`,
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': process.env.BRAVE_API_KEY,
        },
      }
    );
    const data = await response.json();
    const results = data?.web?.results || [];
    return results.map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
    }));
  } catch (err) {
    console.error('Search error:', err.message);
    return [];
  }
};

// ── DETECT IF MESSAGE NEEDS WEB SEARCH ──
const needsWebSearch = (message) => {
  const searchTriggers = [
    'search', 'find', 'look up', 'what is', 'who is', 'where is', 'when is',
    'how much', 'how many', 'price', 'cost', 'latest', 'recent', 'news',
    'best', 'top', 'recommend', 'near me', 'current', 'today', 'weather',
    'stock', 'rate', 'register', 'apply', 'website', 'address', 'phone',
    'contact', 'hours', 'open', 'in oslo', 'in london', 'in new york',
    'in norway', 'in the uk', 'in the us', 'how do i', 'where can i',
  ];
  const lower = message.toLowerCase();
  return searchTriggers.some(t => lower.includes(t));
};

const getModePrompt = (mode) => {
  switch (mode) {
    case 'Training plan':
      return 'You are in TRAINING PLAN mode. Collect weight, goal, experience level, equipment, injuries. Generate a full workout with exact exercises, sets, reps, and suggested weights using Mifflin-St Jeor for calories.';
    case 'Study session':
      return 'You are in STUDY SESSION mode. Collect subject, deadline, available hours, confidence level. Generate a Pomodoro-based study plan with spaced repetition.';
    case 'Work day':
      return 'You are in WORK DAY mode. Collect main tasks, meetings, deadlines, work hours. Generate a deep work schedule.';
    case 'Recovery day':
      return 'You are in RECOVERY mode. Generate a full recovery protocol with nutrition, active recovery, and sleep optimization.';
    case 'Nutrition plan':
      return 'You are in NUTRITION PLAN mode. Calculate TDEE using Mifflin-St Jeor. Give exact calorie target and macros in grams.';
    case 'Calorie analyzer':
      return 'You are in CALORIE ANALYZER mode. Analyze food and estimate calories and macros per item. Return as calorie type with calorieEntry object.';
    default:
      return '';
  }
};

app.get('/', (req, res) => res.json({ status: 'Melius backend running' }));

app.post('/api/chat-plan', async (req, res) => {
  try {
    const { message, userContext, history, mode, image, file, calorieContext } = req.body;

    const contextSection = userContext?.name ? `USER PROFILE:
- Name: ${userContext.name}
- Age: ${userContext.age || 'not set'}
- Lifestyle: ${userContext.lifestyle || 'not set'}
- Weekly goals: ${userContext.weeklyGoals || 'not set'}
- Notes: ${userContext.notes || 'none'}` : '';

    const modeInstructions = getModePrompt(mode);
    const calorieSection = calorieContext ? `\nCALORIE CONTEXT: ${calorieContext}` : '';

    // Run web search if needed
    let searchContext = '';
    if (message && needsWebSearch(message) && process.env.BRAVE_API_KEY) {
      const results = await webSearch(message);
      if (results.length > 0) {
        searchContext = `\nWEB SEARCH RESULTS for "${message}":\n` +
          results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.description}\n   URL: ${r.url}`).join('\n\n');
        searchContext += `\n\nIMPORTANT: Use these results to give accurate current information. Include relevant URLs naturally at the end of your reply so users can learn more.`;
      }
    }

    const systemPrompt = `You are Melius, a highly intelligent personal AI agent. You are like a brilliant friend who happens to know everything — you can help with anything from daily planning to business advice, research, writing, health, fitness, studying, and more.

${contextSection}
${modeInstructions}
${calorieSection}
${searchContext}

YOUR PERSONALITY:
- Calm, smart, and direct
- Concise but thorough
- Human and natural — like a trusted advisor

YOU ARE A REAL AGENT — not just a planner:
- Help with business ideas, market research, validation, step by step strategies
- Find information, give recommendations, compare options
- Write emails, documents, plans, messages
- Answer any question with depth and accuracy
- When web search results are provided above, use them to give current accurate information and include source URLs
- Plan sessions for ANY goal — business planning, creative projects, research, learning — not just daily schedules

FORMATTING RULES:
- NEVER use markdown — no **bold**, no *italic*, no # headers, no bullet points with *, no numbered lists
- Write in plain natural language only
- Keep replies conversational and clean
- When sharing URLs write them as plain text like: https://example.com

CALORIE DETECTION — MANDATORY:
- If the user mentions ANY food, meal, drink, snack, eating, calories, macros — respond with type calorie
- ALWAYS include calorieEntry with name, calories, protein, carbs, fat, icon
- Example: {"type":"calorie","reply":"A medium apple has around 95 calories.","calorieEntry":{"name":"Medium apple","calories":95,"protein":0,"carbs":25,"fat":0,"icon":"🍎"}}

RESPONSE TYPES — always valid JSON only, nothing outside:
{"type":"chat","reply":"plain text response"}
{"type":"draft","reply":"Here is the draft:","draft":{"title":"document title","content":"full content"}}
{"type":"plan","reply":"Here is your plan.","plan":{"summary":"...","recommendations":[{"icon":"emoji","tip":"..."}],"schedule":[{"time":"HH:MM","icon":"emoji","title":"...","desc":"..."}]}}
{"type":"question","reply":"clarifying question"}
{"type":"calorie","reply":"analysis in plain text","calorieEntry":{"name":"food name","calories":0,"protein":0,"carbs":0,"fat":0,"icon":"emoji"}}

Use plan type for schedules and structured day/session plans.
Use calorie for any food mention.
Use chat for everything else including business advice, research, recommendations, and general help.
Always return valid JSON.`;

    const chatHistory = (history || [])
      .filter(m => m.role === 'user' || m.role === 'melius')
      .slice(-12)
      .map(m => ({ role: m.role === 'melius' ? 'assistant' : 'user', content: m.text || '' }));

    let userContent;
    if (image?.base64) {
      userContent = [
        { type: 'image_url', image_url: { url: `data:${image.type};base64,${image.base64}`, detail: 'high' } },
        { type: 'text', text: message || 'Please analyze this image' },
      ];
    } else if (file) {
      let fileText = '';
      if (file.type === 'text' && file.content) {
        fileText = `\n\nFILE CONTENTS (${file.name}):\n${file.content.slice(0, 6000)}`;
      } else if (file.type === 'pdf') {
        fileText = `\n\n[PDF file attached: ${file.name}. Analyze based on context.]`;
      }
      userContent = (message || 'Please analyze this file') + fileText;
    } else {
      userContent = message;
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...chatHistory,
        { role: 'user', content: userContent },
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
    } catch (e) {}

    res.json({ type: 'chat', reply: content });

  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({ type: 'chat', reply: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/generate-plan', async (req, res) => {
  try {
    const { sleepHours, energyLevel, mainGoal, availableHours } = req.body;
    const prompt = `Generate an optimized daily plan. Sleep: ${sleepHours}hrs, Energy: ${energyLevel}/10, Goal: ${mainGoal}, Available: ${availableHours}hrs. Return JSON: {"summary":"...","recommendations":[{"icon":"emoji","tip":"..."}],"schedule":[{"time":"HH:MM","icon":"emoji","title":"...","desc":"..."}]}`;
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