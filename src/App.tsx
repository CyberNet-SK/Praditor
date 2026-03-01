import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Terminal, 
  Shield, 
  Lock, 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Send, 
  Cpu, 
  Activity, 
  ChevronRight,
  Zap,
  Eye,
  Menu,
  X,
  MessageSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { gemini } from './services/geminiService';
import { cn } from './utils/cn';

interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'model',
      content: 'System initialized. Predator online. Standing by for tactical briefing or vulnerability assessment. How can I assist your operation today?',
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isTTSActive, setIsTTSActive] = useState(true);
  const [isSTTActive, setIsSTTActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeModule, setActiveModule] = useState('terminal');
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const history = messages.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.content }]
      }));

      const response = await gemini.chat(input, history);
      const modelContent = response.text || "Error: No response from system.";
      
      const modelMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: modelContent,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, modelMessage]);

      if (isTTSActive && modelContent) {
        playTTS(modelContent);
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        content: "System error encountered. Connection unstable. Please retry.",
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const playTTS = async (text: string) => {
    try {
      const base64Audio = await gemini.generateTTS(text);
      if (base64Audio) {
        const audioData = atob(base64Audio);
        const arrayBuffer = new ArrayBuffer(audioData.length);
        const view = new Uint8Array(arrayBuffer);
        for (let i = 0; i < audioData.length; i++) {
          view[i] = audioData.charCodeAt(i);
        }

        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        
        const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        source.start(0);
      }
    } catch (error) {
      console.error("TTS error:", error);
    }
  };

  const toggleLive = async () => {
    if (isLiveActive) {
      liveSessionRef.current?.close();
      setIsLiveActive(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      const session = await gemini.connectLive({
        onopen: () => {
          console.log("Live session opened");
          setIsLiveActive(true);
        },
        onmessage: async (message) => {
          const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (base64Audio) {
            const audioData = atob(base64Audio);
            const arrayBuffer = new ArrayBuffer(audioData.length);
            const view = new Uint8Array(arrayBuffer);
            for (let i = 0; i < audioData.length; i++) {
              view[i] = audioData.charCodeAt(i);
            }
            
            // For live audio, we need to handle PCM chunks. 
            // This is a simplified version; real-time PCM playback usually needs a queue.
            const playbackCtx = new AudioContext({ sampleRate: 24000 });
            const buffer = await playbackCtx.decodeAudioData(arrayBuffer);
            const source = playbackCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(playbackCtx.destination);
            source.start(0);
          }
        },
        onclose: () => setIsLiveActive(false),
        onerror: (err) => console.error("Live error:", err),
      });

      processor.onaudioprocess = (e) => {
        if (isLiveActive) {
          const inputData = e.inputBuffer.getChannelData(0);
          // Convert Float32 to Int16 PCM
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
          }
          const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
          session.sendRealtimeInput({
            media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      liveSessionRef.current = session;
    } catch (error) {
      console.error("Live activation error:", error);
    }
  };

  const startSTT = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsSTTActive(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
    };
    recognition.onerror = () => setIsSTTActive(false);
    recognition.onend = () => setIsSTTActive(false);

    recognition.start();
  };

  return (
    <div className="flex h-screen w-full overflow-hidden terminal-bg font-sans">
      <div className="scanline" />
      
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 280 : 80 }}
        className="relative z-10 flex flex-col border-r border-border bg-surface/50 backdrop-blur-xl transition-all duration-300"
      >
        <div className="flex items-center justify-between p-6">
          {isSidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-3"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-matrix/10 border border-matrix/30">
                <Shield className="h-6 w-6 text-matrix glow-text" />
              </div>
              <span className="text-xl font-bold tracking-tighter text-white">PREDATOR</span>
            </motion.div>
          )}
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="rounded-md p-1 hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
          >
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav className="flex-1 space-y-2 px-4 py-4">
          <SidebarItem 
            icon={<Terminal size={20} />} 
            label="Terminal" 
            active={activeModule === 'terminal'} 
            collapsed={!isSidebarOpen}
            onClick={() => setActiveModule('terminal')}
          />
          <SidebarItem 
            icon={<Zap size={20} />} 
            label="Live Assistant" 
            active={activeModule === 'live'} 
            collapsed={!isSidebarOpen}
            onClick={() => setActiveModule('live')}
          />
          <SidebarItem 
            icon={<Eye size={20} />} 
            label="Vuln Scan" 
            active={activeModule === 'scan'} 
            collapsed={!isSidebarOpen}
            onClick={() => setActiveModule('scan')}
          />
          <SidebarItem 
            icon={<Lock size={20} />} 
            label="Encryption" 
            active={activeModule === 'crypto'} 
            collapsed={!isSidebarOpen}
            onClick={() => setActiveModule('crypto')}
          />
        </nav>

        <div className="p-4 border-t border-border">
          <div className={cn("flex items-center gap-3 rounded-lg bg-matrix/5 p-3 border border-matrix/10", !isSidebarOpen && "justify-center")}>
            <Activity className="h-4 w-4 text-matrix animate-pulse" />
            {isSidebarOpen && (
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-matrix/60 font-mono">System Status</span>
                <span className="text-xs font-mono text-matrix">SECURE_LINK_ACTIVE</span>
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="z-20 flex h-16 items-center justify-between border-b border-border bg-surface/30 px-8 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="h-2 w-2 rounded-full bg-matrix animate-pulse shadow-[0_0_8px_#00ff41]" />
            <h2 className="text-sm font-mono tracking-widest text-matrix uppercase">
              {activeModule} // session_id: {Math.random().toString(36).substring(7).toUpperCase()}
            </h2>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-xs font-mono text-gray-500">
              <Cpu size={14} />
              <span>LOAD: 12.4%</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setIsTTSActive(!isTTSActive)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-mono transition-all",
                  isTTSActive ? "bg-matrix/10 text-matrix border border-matrix/30" : "bg-white/5 text-gray-500 border border-transparent"
                )}
              >
                {isTTSActive ? <Volume2 size={14} /> : <VolumeX size={14} />}
                <span>VOICE_BRIEF</span>
              </button>
              <button 
                onClick={toggleLive}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-mono transition-all",
                  isLiveActive ? "bg-red-500/10 text-red-500 border border-red-500/30" : "bg-white/5 text-gray-500 border border-transparent"
                )}
              >
                <Mic size={14} className={isLiveActive ? "animate-pulse" : ""} />
                <span>LIVE_LINK</span>
              </button>
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-8 space-y-8 scroll-smooth"
        >
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex w-full gap-4",
                  msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                )}
              >
                <div className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                  msg.role === 'user' ? "bg-white/5 border-white/10" : "bg-matrix/10 border-matrix/30"
                )}>
                  {msg.role === 'user' ? <MessageSquare size={18} className="text-gray-400" /> : <Shield size={18} className="text-matrix" />}
                </div>
                
                <div className={cn(
                  "flex max-w-[80%] flex-col gap-2",
                  msg.role === 'user' ? "items-end" : "items-start"
                )}>
                  <div className={cn(
                    "rounded-2xl px-6 py-4 text-sm leading-relaxed",
                    msg.role === 'user' 
                      ? "bg-white/5 text-gray-200 border border-white/10 rounded-tr-none" 
                      : "bg-surface border border-border text-gray-300 rounded-tl-none glow-border"
                  )}>
                    <div className="markdown-body">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-gray-600 uppercase">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {isLoading && (
            <div className="flex gap-4">
              <div className="flex h-10 w-10 animate-pulse items-center justify-center rounded-lg bg-matrix/10 border border-matrix/30">
                <Shield size={18} className="text-matrix" />
              </div>
              <div className="flex items-center gap-1">
                <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-matrix" style={{ animationDelay: '0ms' }} />
                <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-matrix" style={{ animationDelay: '150ms' }} />
                <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-matrix" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-8">
          <form 
            onSubmit={handleSend}
            className="relative flex items-center gap-4 rounded-2xl bg-surface/50 p-2 border border-border backdrop-blur-xl focus-within:border-matrix/30 transition-all"
          >
            <button 
              type="button"
              onClick={startSTT}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-xl transition-all",
                isSTTActive ? "bg-matrix text-bg" : "bg-white/5 text-gray-400 hover:text-white"
              )}
            >
              {isSTTActive ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            
            <input 
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter tactical command or query..."
              className="flex-1 bg-transparent px-2 py-3 text-sm font-mono text-white outline-none placeholder:text-gray-600"
            />

            <button 
              type="submit"
              disabled={!input.trim() || isLoading}
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-matrix text-bg hover:bg-matrix/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_15px_rgba(0,255,65,0.3)]"
            >
              <Send size={20} />
            </button>
          </form>
          <div className="mt-4 flex justify-center gap-8 text-[10px] font-mono text-gray-600 uppercase tracking-[0.2em]">
            <span>Protocol: 0x7A_ALPHA</span>
            <span>Encryption: AES-256-GCM</span>
            <span>Origin: SECURE_NODE_01</span>
          </div>
        </div>

        {/* Live Visualizer Overlay */}
        <AnimatePresence>
          {isLiveActive && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-bg/90 backdrop-blur-2xl"
            >
              <div className="relative flex h-64 w-64 items-center justify-center">
                <motion.div 
                  animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 rounded-full bg-matrix/10 border border-matrix/20"
                />
                <motion.div 
                  animate={{ scale: [1, 1.5, 1], opacity: [0.1, 0.3, 0.1] }}
                  transition={{ duration: 3, repeat: Infinity }}
                  className="absolute inset-0 rounded-full bg-matrix/5 border border-matrix/10"
                />
                <div className="relative flex flex-col items-center gap-4">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-matrix/20 border-2 border-matrix shadow-[0_0_30px_rgba(0,255,65,0.4)]">
                    <Mic size={40} className="text-matrix animate-pulse" />
                  </div>
                  <div className="flex gap-1 h-8 items-end">
                    {[...Array(8)].map((_, i) => (
                      <motion.div 
                        key={i}
                        animate={{ height: [4, Math.random() * 24 + 8, 4] }}
                        transition={{ duration: 0.5 + Math.random(), repeat: Infinity }}
                        className="w-1.5 bg-matrix rounded-full"
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-12 text-center space-y-2">
                <h3 className="text-2xl font-bold tracking-widest text-white glow-text">LIVE_LINK_ESTABLISHED</h3>
                <p className="font-mono text-matrix/60 text-sm">Speak naturally. Predator is listening...</p>
              </div>
              <button 
                onClick={toggleLive}
                className="mt-12 rounded-full border border-red-500/50 bg-red-500/10 px-8 py-3 font-mono text-sm text-red-500 hover:bg-red-500/20 transition-all"
              >
                TERMINATE_SESSION
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active, collapsed, onClick }: { 
  icon: React.ReactNode; 
  label: string; 
  active?: boolean; 
  collapsed?: boolean;
  onClick?: () => void;
}) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-4 py-3 transition-all group",
        active 
          ? "bg-matrix/10 text-matrix border border-matrix/20" 
          : "text-gray-500 hover:text-gray-300 hover:bg-white/5 border border-transparent",
        collapsed && "justify-center px-0"
      )}
    >
      <div className={cn(
        "transition-transform group-hover:scale-110",
        active && "glow-text"
      )}>
        {icon}
      </div>
      {!collapsed && (
        <span className={cn(
          "text-sm font-medium tracking-wide",
          active ? "text-white" : "text-gray-500"
        )}>
          {label}
        </span>
      )}
      {!collapsed && active && (
        <motion.div 
          layoutId="active-pill"
          className="ml-auto h-1.5 w-1.5 rounded-full bg-matrix shadow-[0_0_8px_#00ff41]" 
        />
      )}
    </button>
  );
}
