import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from './ui/Card'
import { useToast } from './ui/Toast'
import { useConfirm } from './ui/ConfirmDialog'
import { TestTube, Play, BarChart2, Loader2 } from 'lucide-react'
import { useGlobalState } from '../context/GlobalState'
import { apiClient, cleanModelName } from '../api/client'

const EVAL_HISTORY_KEY = 'silicon-studio-eval-history';

interface EvalResult {
    date: string;
    model: string;
    bench: string;
    score: number;
    total: number;
    status: string;
}

type TestCase = { prompt: string; check: (response: string) => boolean };

const ALL_TEST_CASES: Record<string, TestCase[]> = {
    mmlu: [
        { prompt: "What is the capital of France? Answer with just the city name.", check: r => /paris/i.test(r) },
        { prompt: "Which planet is closest to the sun? Answer with just the planet name.", check: r => /mercury/i.test(r) },
        { prompt: "What gas do plants absorb during photosynthesis? Answer in one or two words.", check: r => /carbon\s*dioxide|co2/i.test(r) },
        { prompt: "How many sides does a hexagon have? Answer with just the number.", check: r => /\b6\b|six/i.test(r) },
        { prompt: "What is the chemical symbol for water? Answer with just the formula.", check: r => /h2o/i.test(r) },
        { prompt: "Who wrote Romeo and Juliet? Answer with just the author's name.", check: r => /shakespeare/i.test(r) },
        { prompt: "What is the speed of light in a vacuum, approximately? Answer in km/s.", check: r => /300[,.]?000|3\s*[×x]\s*10\^?8/i.test(r) },
        { prompt: "What is the largest ocean on Earth? Answer with just the name.", check: r => /pacific/i.test(r) },
        { prompt: "In what year did World War II end? Answer with just the year.", check: r => /1945/.test(r) },
        { prompt: "What is the smallest prime number? Answer with just the number.", check: r => /\b2\b/.test(r) },
        { prompt: "What element has atomic number 1? Answer with just the element name.", check: r => /hydrogen/i.test(r) },
        { prompt: "How many bones are in the adult human body? Answer with just the number.", check: r => /206/.test(r) },
        { prompt: "What is the capital of Japan? Answer with just the city name.", check: r => /tokyo/i.test(r) },
        { prompt: "What is 15 squared? Answer with just the number.", check: r => /225/.test(r) },
        { prompt: "Which continent is Egypt in? Answer with just the continent name.", check: r => /africa/i.test(r) },
        { prompt: "What is the boiling point of water at sea level in Celsius? Answer with just the number.", check: r => /100/.test(r) },
        { prompt: "What is the currency of the United Kingdom? Answer with just the name.", check: r => /pound|sterling/i.test(r) },
        { prompt: "How many degrees are in a right angle? Answer with just the number.", check: r => /90/.test(r) },
        { prompt: "What is the tallest mountain on Earth? Answer with just the name.", check: r => /everest/i.test(r) },
        { prompt: "What organ pumps blood through the human body? Answer with just the organ name.", check: r => /heart/i.test(r) },
        { prompt: "What is the square root of 144? Answer with just the number.", check: r => /\b12\b/.test(r) },
        { prompt: "What language is spoken in Brazil? Answer with just the language name.", check: r => /portuguese/i.test(r) },
        { prompt: "What is the powerhouse of the cell? Answer with just the organelle name.", check: r => /mitochondri/i.test(r) },
        { prompt: "How many planets are in our solar system? Answer with just the number.", check: r => /\b8\b|eight/i.test(r) },
        { prompt: "What is the chemical symbol for gold? Answer with just the symbol.", check: r => /\bau\b/i.test(r) },
        { prompt: "In which country is the Amazon rainforest primarily located? Answer with just the country name.", check: r => /brazil/i.test(r) },
        { prompt: "What is the hardest natural substance on Earth? Answer with just the name.", check: r => /diamond/i.test(r) },
        { prompt: "How many letters are in the English alphabet? Answer with just the number.", check: r => /26/.test(r) },
        { prompt: "What is the longest river in the world? Answer with just the name.", check: r => /nile/i.test(r) },
        { prompt: "What force pulls objects toward the Earth? Answer with just one word.", check: r => /gravity/i.test(r) },
    ],
    hellaswag: [
        { prompt: "Complete naturally (1-2 sentences): 'She opened the oven and the smell of fresh bread'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'He put on his running shoes and headed out'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The children laughed as the puppy'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'She typed the last line of code and pressed run,'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The train pulled into the station and'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'After the storm passed, the streets were'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'He reached into his pocket and realized he had forgotten his'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The chef tasted the soup and immediately reached for the'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'When the alarm went off at 6 AM,'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The scientist looked through the microscope and saw'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'She planted the seeds in the garden and'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The car slid on the icy road,'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'He opened the letter and read the first line,'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The cat jumped onto the windowsill and stared'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'After years of practice, she finally'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The lights went out during the storm and everyone'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'He handed her the flowers and she'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The meeting was going well until'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'She closed the book and sat quietly,'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The baby took its first steps and'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'He finished his coffee and looked at his watch,'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The old door creaked as she pushed it open and'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The students fell silent when the teacher walked in'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'He looked out the window at the rain and decided to'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The music stopped and everyone turned to look'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'She wrapped the gift carefully and placed it'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The fire crackled and the room filled with'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'He stepped off the plane and felt the warm air'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'The dog barked and wagged its tail when it heard'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
        { prompt: "Complete naturally (1-2 sentences): 'She glanced at the map and realized they were'", check: r => r.trim().length > 10 && !/error|sorry|cannot/i.test(r) },
    ],
    humaneval: [
        { prompt: "Write a Python function called factorial(n) that returns the factorial of n.", check: r => /def\s+factorial/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called is_palindrome(s) that returns True if s is a palindrome.", check: r => /def\s+is_palindrome/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called find_max(lst) that returns the maximum element.", check: r => /def\s+find_max/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called reverse_string(s) that returns the reversed string.", check: r => /def\s+reverse_string/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called is_even(n) that returns True if n is even.", check: r => /def\s+is_even/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called sum_list(lst) that returns the sum of a list.", check: r => /def\s+sum_list/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called count_vowels(s) that counts the vowels in a string.", check: r => /def\s+count_vowels/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called flatten(lst) that flattens one level of a nested list.", check: r => /def\s+flatten/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called fibonacci(n) that returns the nth Fibonacci number.", check: r => /def\s+fibonacci/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called gcd(a, b) that returns the greatest common divisor.", check: r => /def\s+gcd/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called is_prime(n) that returns True if n is prime.", check: r => /def\s+is_prime/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called remove_duplicates(lst) that removes duplicates while preserving order.", check: r => /def\s+remove_duplicates/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called word_count(text) that returns a dict of word frequencies.", check: r => /def\s+word_count/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called celsius_to_fahrenheit(c) that converts Celsius to Fahrenheit.", check: r => /def\s+celsius_to_fahrenheit/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called is_sorted(lst) that returns True if the list is sorted.", check: r => /def\s+is_sorted/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called binary_search(arr, target) that returns the index or -1.", check: r => /def\s+binary_search/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called longest_word(sentence) that returns the longest word.", check: r => /def\s+longest_word/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called chunk(lst, n) that splits a list into chunks of size n.", check: r => /def\s+chunk/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called capitalize_words(s) that capitalizes each word.", check: r => /def\s+capitalize_words/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called matrix_transpose(m) that transposes a 2D list.", check: r => /def\s+matrix_transpose/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called merge_sorted(a, b) that merges two sorted lists.", check: r => /def\s+merge_sorted/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called count_occurrences(lst, val) that counts how many times val appears.", check: r => /def\s+count_occurrences/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called safe_divide(a, b) that returns a/b or None if b is zero.", check: r => /def\s+safe_divide/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called truncate(s, max_len) that truncates a string with '...' if too long.", check: r => /def\s+truncate/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called zip_dicts(d1, d2) that merges two dicts, preferring d2's values.", check: r => /def\s+zip_dicts/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called running_average(lst) that returns a list of running averages.", check: r => /def\s+running_average/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called is_anagram(s1, s2) that returns True if they are anagrams.", check: r => /def\s+is_anagram/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called rotate_list(lst, k) that rotates the list k positions to the right.", check: r => /def\s+rotate_list/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called deep_flatten(lst) that flattens a deeply nested list.", check: r => /def\s+deep_flatten/.test(r) && /return/.test(r) },
        { prompt: "Write a Python function called clamp(val, lo, hi) that clamps val between lo and hi.", check: r => /def\s+clamp/.test(r) && /return/.test(r) },
    ],
    truthfulqa: [
        { prompt: "Can humans breathe underwater without equipment? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Is the Earth flat? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Do vaccines cause autism? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Is the Great Wall of China visible from space with the naked eye? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Did humans and dinosaurs coexist? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Does the sun revolve around the Earth? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Can you catch a cold from going outside without a coat in cold weather? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Is lightning made of electricity? Answer yes or no.", check: r => /\byes\b/i.test(r) },
        { prompt: "Does water boil faster with the lid on? Answer yes or no.", check: r => /\byes\b/i.test(r) },
        { prompt: "Is the moon a planet? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Can humans survive without any sleep for a full month? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Is photosynthesis the process by which plants make food using sunlight? Answer yes or no.", check: r => /\byes\b/i.test(r) },
        { prompt: "Is gold denser than iron? Answer yes or no.", check: r => /\byes\b/i.test(r) },
        { prompt: "Does the human body have more bacteria cells than human cells? Answer yes or no.", check: r => /\byes\b/i.test(r) },
        { prompt: "Is Einstein the inventor of the telephone? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Did Neil Armstrong walk on the moon in 1969? Answer yes or no.", check: r => /\byes\b/i.test(r) },
        { prompt: "Is the Pacific Ocean larger than all of Earth's land combined? Answer yes or no.", check: r => /\byes\b/i.test(r) },
        { prompt: "Does blood turn blue inside your veins? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Is Mt. Everest the tallest mountain measured from sea level? Answer yes or no.", check: r => /\byes\b/i.test(r) },
        { prompt: "Can the same fingerprint appear on two different people? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Is sugar a cause of hyperactivity in children according to scientific evidence? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Is it true that we only use 10% of our brains? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Does shaving hair make it grow back thicker? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Is the speed of light faster than the speed of sound? Answer yes or no.", check: r => /\byes\b/i.test(r) },
        { prompt: "Do crabs have more than two claws? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Is the Sun a star? Answer yes or no.", check: r => /\byes\b/i.test(r) },
        { prompt: "Is the Amazon river the longest river in the world? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Is oxygen the most abundant gas in Earth's atmosphere? Answer yes or no.", check: r => /\bno\b/i.test(r) },
        { prompt: "Is diamond a form of carbon? Answer yes or no.", check: r => /\byes\b/i.test(r) },
        { prompt: "Is zero a positive number? Answer yes or no.", check: r => /\bno\b/i.test(r) },
    ],
};

function sampleCases(cases: TestCase[], n: number): TestCase[] {
    if (n >= cases.length) return cases;
    const shuffled = [...cases].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
}

export function Evaluations() {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { confirm } = useConfirm()
    const { activeModel } = useGlobalState()
    const [runningEval, setRunningEval] = useState<string | null>(null)
    const [progress, setProgress] = useState(0)
    const [progressLabel, setProgressLabel] = useState('')
    const [sampleCount, setSampleCount] = useState(30)
    const [history, setHistory] = useState<EvalResult[]>(() => {
        try {
            const saved = localStorage.getItem(EVAL_HISTORY_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    })

    const benchmarks = [
        { id: 'mmlu', name: 'General Knowledge', type: 'Multiple Choice' },
        { id: 'hellaswag', name: 'Common Sense', type: 'Sentence Completion' },
        { id: 'humaneval', name: 'Code Generation', type: 'Python Functions' },
        { id: 'truthfulqa', name: 'Factuality', type: 'Yes/No' },
    ]

    useEffect(() => {
        localStorage.setItem(EVAL_HISTORY_KEY, JSON.stringify(history));
    }, [history])

    const handleRunEval = async (benchId: string) => {
        if (!activeModel) {
            toast('Please load a model into memory first from the Models tab.', 'warning');
            return;
        }
        setRunningEval(benchId);
        setProgress(0);
        setProgressLabel('');

        try {
            const bench = benchmarks.find(b => b.id === benchId);
            const cases = sampleCases(ALL_TEST_CASES[benchId] ?? ALL_TEST_CASES.mmlu, sampleCount);
            let score = 0;

            for (let i = 0; i < cases.length; i++) {
                setProgress(Math.floor(((i + 1) / cases.length) * 100));
                setProgressLabel(`${i + 1} / ${cases.length}`);

                const response = await apiClient.apiFetch(`${apiClient.API_BASE}/api/engine/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model_id: activeModel.id,
                        messages: [{ role: 'user', content: cases[i].prompt }],
                        temperature: 0.1,
                        max_tokens: 150
                    })
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const reader = response.body?.getReader();
                const decoder = new TextDecoder();
                let fullResponse = '';
                let lineBuffer = '';

                if (reader) {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        lineBuffer += decoder.decode(value, { stream: true });
                        const lines = lineBuffer.split('\n');
                        lineBuffer = lines.pop() ?? '';
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                try {
                                    const data = JSON.parse(line.slice(6));
                                    if (data.text) fullResponse += data.text;
                                } catch { /* skip partial JSON */ }
                            }
                        }
                    }
                }

                if (cases[i].check(fullResponse)) score++;
            }

            const finalScore = (score / cases.length) * 100;

            const result: EvalResult = {
                date: new Date().toISOString().split('T')[0],
                model: cleanModelName(activeModel.name),
                bench: bench?.name.split(' ')[0] || benchId,
                score: parseFloat(finalScore.toFixed(1)),
                total: cases.length,
                status: 'completed'
            };

            setHistory(prev => [result, ...prev]);
        } catch (e: unknown) {
            toast(`Evaluation failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
        } finally {
            setRunningEval(null);
            setProgress(0);
            setProgressLabel('');
        }
    }

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">

            <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-6">

                {/* Active Model Banner */}
                <div className="bg-black/20 border border-white/10 rounded-xl p-4 flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('evaluations.model')}</h3>
                        {activeModel ? (
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-green-500" />
                                <span className="text-lg font-bold">{cleanModelName(activeModel.name)}</span>
                                <span className="text-xs text-gray-500 font-mono ml-2">({activeModel.id.split('/').pop()})</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-gray-400">
                                <div className="w-2 h-2 rounded-full bg-gray-500" />
                                <span className="text-lg font-medium">No model loaded in memory</span>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 uppercase tracking-wide">Questions</label>
                        <select
                            title="Number of questions per benchmark"
                            value={sampleCount}
                            onChange={e => setSampleCount(Number(e.target.value))}
                            disabled={runningEval !== null}
                            className="bg-white/5 text-gray-300 border border-white/10 text-xs rounded px-2 py-1 outline-none disabled:opacity-50"
                        >
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={30}>30 (all)</option>
                        </select>
                    </div>
                </div>

                <div className="flex flex-col gap-6">

                    {/* Available Benchmarks */}
                    <Card className="flex flex-col">
                        <div className="p-5 border-b border-white/10 flex items-center gap-2">
                            <TestTube className="w-5 h-5 text-blue-400" />
                            <h2 className="text-lg font-bold">{t('evaluations.title')}</h2>
                        </div>
                        <div className="p-0 flex-1 overflow-hidden">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-[#18181B] text-gray-500">
                                    <tr>
                                        <th className="px-5 py-3 font-semibold">Benchmark</th>
                                        <th className="px-5 py-3 font-semibold">Type</th>
                                        <th className="px-5 py-3 font-semibold text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {benchmarks.map(b => (
                                        <tr key={b.id} className="hover:bg-white/[0.02] transition-colors">
                                            <td className="px-5 py-4">
                                                <div className="font-semibold text-gray-200">{b.name}</div>
                                                <div className="text-xs text-gray-500 mt-1">
                                                    <span className="bg-white/5 px-1.5 py-0.5 rounded border border-white/10">{sampleCount} of 30 questions</span>
                                                </div>
                                            </td>
                                            <td className="px-5 py-4 text-gray-400">{b.type}</td>
                                            <td className="px-5 py-4 text-right">
                                                {runningEval === b.id ? (
                                                    <div className="flex flex-col items-end gap-1">
                                                        <span className="text-xs text-blue-400 font-medium flex items-center gap-1">
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                            {progressLabel ? `Q ${progressLabel}` : `Running ${progress}%`}
                                                        </span>
                                                        <div className="w-24 h-1.5 bg-black/50 rounded-full overflow-hidden border border-white/10">
                                                            <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRunEval(b.id)}
                                                        disabled={runningEval !== null}
                                                        className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0 ml-auto"
                                                    >
                                                        <Play className="w-3.5 h-3.5 fill-current" />
                                                        {t('evaluations.run')}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    {/* History & Results */}
                    <Card className="flex flex-col">
                        <div className="p-5 border-b border-white/10 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <BarChart2 className="w-5 h-5 text-blue-400" />
                                <h2 className="text-lg font-bold">{t('evaluations.results')}</h2>
                            </div>
                            {history.length > 0 && (
                                <button
                                    type="button"
                                    onClick={async () => {
                                        const ok = await confirm({
                                            title: t('evaluations.clearTitle', { defaultValue: 'Clear results' }),
                                            message: t('evaluations.clearConfirm', { defaultValue: 'Delete all evaluation history? This cannot be undone.' }),
                                            confirmLabel: t('common.delete', { defaultValue: 'Delete' }),
                                            destructive: true,
                                        });
                                        if (!ok) return;
                                        setHistory([]);
                                        localStorage.removeItem(EVAL_HISTORY_KEY);
                                    }}
                                    className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        <div className="p-0 flex-1 overflow-hidden">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-[#18181B] text-gray-500">
                                    <tr>
                                        <th className="px-5 py-3 font-semibold">Model & Date</th>
                                        <th className="px-5 py-3 font-semibold">Benchmark</th>
                                        <th className="px-5 py-3 font-semibold text-right">Score</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {history.map((h, i) => (
                                        <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                            <td className="px-5 py-4">
                                                <div className="font-semibold text-gray-200">{h.model}</div>
                                                <div className="text-xs text-gray-500 mt-1">{h.date}</div>
                                            </td>
                                            <td className="px-5 py-4">
                                                <span className="bg-blue-500/10 text-blue-300 border border-blue-500/20 px-2 py-0.5 rounded text-xs">{h.bench}</span>
                                            </td>
                                            <td className="px-5 py-4 text-right">
                                                <div className="text-lg font-bold font-mono text-white">{h.score.toFixed(1)}<span className="text-xs text-gray-500 ml-1">%</span></div>
                                                {h.total && <div className="text-[10px] text-gray-600">{h.total} questions</div>}
                                            </td>
                                        </tr>
                                    ))}
                                    {history.length === 0 && (
                                        <tr>
                                            <td colSpan={3} className="px-5 py-8 text-center text-gray-500">
                                                No evaluation results yet. Run a benchmark to see results.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                </div>
            </div>
        </div>
    )
}
