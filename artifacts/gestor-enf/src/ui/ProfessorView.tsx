import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";

interface PlayerData {
  playerId: string;
  playerName: string;
  online: boolean;
  currentRoom: string;
  prestige: number;
  energy: number;
  stress: number;
  level: string;
  completedMissions: number;
  lastActivity: string;
  shiftTime: number;
}

const CARD_COLORS = [
  "#1abc9c",
  "#3498db",
  "#9b59b6",
  "#e67e22",
  "#e74c3c",
  "#27ae60",
  "#f39c12",
  "#2980b9",
];

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function StatBar({
  value,
  color,
  label,
  display,
}: {
  value: number;
  color: string;
  label: string;
  display: string;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs text-gray-500 font-mono">{label}</span>
        <span className="text-xs font-mono" style={{ color }}>
          {display}
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: "#111c2e" }}
      >
        <motion.div
          className="h-full rounded-full"
          animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{ background: color }}
        />
      </div>
    </div>
  );
}

function gridClass(n: number): string {
  if (n <= 1) return "grid-cols-1 w-full h-full";
  if (n <= 2) return "grid-cols-2 w-full h-full";
  if (n <= 4) return "grid-cols-2 grid-rows-2 w-full h-full";
  if (n <= 6) return "grid-cols-3 grid-rows-2 w-full h-full";
  return "grid-cols-4 grid-rows-2 w-full h-full";
}

function PlayerScreen({ player, index }: { player: PlayerData; index: number }) {
  const color = CARD_COLORS[index % CARD_COLORS.length];
  
  // Background images for different rooms (using solid colors for now or gradients)
  const getRoomStyle = (room: string) => {
    let bg = "linear-gradient(to bottom, #1e3c72, #2a5298)"; // Default Corredor
    if (room.includes("Copa")) bg = "linear-gradient(to bottom, #d38312, #a83279)";
    if (room.includes("Pacientes")) bg = "linear-gradient(to bottom, #00b4db, #0083b0)";
    if (room.includes("Descanso")) bg = "linear-gradient(to bottom, #11998e, #38ef7d)";
    if (room.includes("Jardim")) bg = "linear-gradient(to bottom, #56ab2f, #a8e063)";
    return bg;
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3 }}
      className="relative flex flex-col border-4 overflow-hidden rounded-lg min-w-0 h-full bg-black shadow-lg"
      style={{
        borderColor: player.online ? color : "#1e2d40",
      }}
    >
      <div 
        className="absolute inset-0 opacity-40 mix-blend-screen"
        style={{ background: getRoomStyle(player.currentRoom) }}
      />
      {/* CCTV overlay effect */}
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjIiIGZpbGw9IiNmZmYiLz48L3N2Zz4=')] mix-blend-overlay" />
      
      {/* Top Bar for the 'screen' */}
      <div className="relative z-10 flex items-center justify-between px-3 py-2 bg-black/60 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: player.online ? "#e74c3c" : "#7f8c8d" }} />
          <span className="text-white font-mono font-bold text-sm tracking-wider uppercase drop-shadow-md">CAM {index + 1} - {player.playerName}</span>
        </div>
        <span className="text-xs font-mono text-white/70 italic p-1 bg-black/40 rounded px-2">{player.level}</span>
      </div>

      {/* Main Screen Content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-4">
        <div className="text-4xl filter drop-shadow-lg mb-2">
          {player.currentRoom.includes("Copa") ? "☕" : 
           player.currentRoom.includes("Descanso") ? "🛏️" : 
           player.currentRoom.includes("Jardim") ? "🌳" : "🏥"}
        </div>
        <h3 className="text-2xl font-bold text-white font-mono text-center drop-shadow-lg mb-1">{player.currentRoom}</h3>
        <p className="text-sm text-gray-300 font-mono text-center bg-black/40 px-3 py-1 rounded-full">{player.lastActivity}</p>
      </div>

      {/* Bottom overlay with HUD like interface */}
      <div className="relative z-10 px-4 py-3 bg-black/80 border-t border-white/10 flex flex-col gap-2">
        <div className="flex justify-between font-mono text-xs text-white">
          <span style={{ color }}>⭐ {player.prestige} PT</span>
          <span>✅ MIS: {player.completedMissions}</span>
          <span>🕐 {formatTime(player.shiftTime)}</span>
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <StatBar value={player.energy} color="#2ecc71" label="ENE" display={`${Math.round(player.energy)}%`} />
          </div>
          <div className="flex-1">
            <StatBar value={player.stress} color={player.stress > 70 ? "#e74c3c" : "#f39c12"} label="STR" display={`${Math.round(player.stress)}%`} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function ProfessorView() {
  const navigate = useNavigate();
  const [players, setPlayers] = useState<PlayerData[]>([]);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchPlayers = useCallback(async () => {
    try {
      const res = await fetch("/api/rooms/GLOBAL/players");
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setPlayers(data.players ?? []);
      setLastRefresh(new Date());
      setError("");
    } catch {
      setError("Erro de conexão");
    }
  }, []);

  useEffect(() => {
    fetchPlayers();
    const id = setInterval(fetchPlayers, 3000);
    return () => clearInterval(id);
  }, [fetchPlayers]);

  const onlineCount = players.filter((p) => p.online).length;

  return (
    /* pointer-events-auto is critical: this sits inside a pointer-events-none shell in App.tsx */
    <div
      className="fixed inset-0 flex flex-col overflow-hidden pointer-events-auto"
      style={{ background: "#060e1a", zIndex: 200 }}
    >
      {/* Top bar */}
      <div
        className="flex items-center gap-4 px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: "#0e2a1e", background: "#0a1628" }}
      >
        <button
          onClick={() => navigate("/")}
          className="font-mono text-sm hover:opacity-70 transition-opacity"
          style={{ color: "#1abc9c" }}
        >
          ← VOLTAR
        </button>
        <h1
          className="flex-1 text-center"
          style={{
            fontFamily: "'Press Start 2P', monospace",
            color: "#1abc9c",
            fontSize: "clamp(10px, 2vw, 15px)",
          }}
        >
          MODO PROFESSOR
        </h1>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-xs font-mono text-gray-600">
              {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: error ? "#e74c3c" : "#2ecc71" }}
          />
        </div>
      </div>

      {/* Stats bar */}
      <div
        className="flex items-center gap-6 px-6 py-3 border-b flex-shrink-0"
        style={{ borderColor: "#0e2a1e", background: "#081420" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-2xl font-mono font-bold" style={{ color: "#1abc9c" }}>
            {onlineCount}
          </span>
          <span className="text-sm font-mono text-gray-500">
            {onlineCount === 1 ? "jogador online" : "jogadores online"}
          </span>
        </div>
        {players.length > onlineCount && (
          <span className="text-xs font-mono text-gray-700">
            + {players.length - onlineCount} offline
          </span>
        )}
        {error && (
          <span className="text-xs font-mono text-red-500 ml-auto">{error}</span>
        )}
      </div>

      {/* Dashboard */}
      <div className="flex-1 overflow-auto p-2 bg-black">
        {players.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-6xl opacity-30">👩‍🏫</div>
            <p className="font-mono text-lg text-gray-600">
              Nenhum jogador ativo no momento
            </p>
            <p className="font-mono text-sm text-gray-700 text-center">
              Assim que os alunos iniciarem o jogo,
              <br />
              eles aparecerão aqui automaticamente.
            </p>
          </div>
        ) : (
          <div className={`grid gap-2 w-full h-full ${gridClass(players.length)}`}>
            <AnimatePresence mode="popLayout">
              {players.map((p, i) => (
                <PlayerScreen key={p.playerId} player={p} index={i} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
