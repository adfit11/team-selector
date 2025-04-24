import React, { useState, useEffect, createContext, useContext, useRef } from "react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  closestCenter,
  DragOverlay
} from "@dnd-kit/core";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

const SupabaseContext = createContext(null);
function SupabaseProvider({ children }) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  return <SupabaseContext.Provider value={supabase}>{children}</SupabaseContext.Provider>;
}
function useSupabase() {
  return useContext(SupabaseContext);
}

function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      <SupabaseProvider>
        <TeamLayout />
      </SupabaseProvider>
    </div>
  );
}

function TeamLayout() {
  const supabase = useSupabase();
  const [players, setPlayers] = useState(initialPlayers);
  const [field, setField] = useState(Array(9).fill(null).map(() => Array(3).fill(null)));
  const [activePlayer, setActivePlayer] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const layoutNameRef = useRef();
  const [savedLayouts, setSavedLayouts] = useState([]);

  const handleDoubleClick = (id) => setEditingId(id);
  const handleNameChange = (id, value) => {
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, name: value } : p));
    setField(prev => prev.map(row => row.map(p => (p?.id === id ? { ...p, name: value } : p))));
  };
  const handleBlur = () => setEditingId(null);

  const handleDragStart = (event) => {
    const draggedFromField = field.flat().find(p => p?.id === event.active.id);
    const draggedFromList = players.find(p => p.id === event.active.id);
    setActivePlayer(draggedFromField || draggedFromList);
  };

  const handleDragEnd = async (event) => {
    const { over, active } = event;
    if (!over) {
      setActivePlayer(null);
      return;
    }

    const newField = field.map(row => row.slice());
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 3; c++) {
        if (newField[r][c]?.id === active.id) newField[r][c] = null;
      }
    }

    let action = null;
    if (over.id === "player-list") {
      const updatedPlayers = [...players];
      const isInList = updatedPlayers.some(p => p.id === active.id);
      const updatedField = newField.map(row => row.map(p => (p?.id === active.id ? null : p)));
      if (!isInList) updatedPlayers.push(activePlayer);
      setPlayers(updatedPlayers);
      setField(updatedField);
      action = { type: "RETURN", id: active.id, player: activePlayer };
    } else {
      const [targetRow, targetCol] = over.id.split("-").map(Number);
      if (newField[targetRow][targetCol]) {
        setField(newField);
        setActivePlayer(null);
        return;
      }
      newField[targetRow][targetCol] = activePlayer;
      const updatedPlayers = players.filter(p => p.id !== active.id);
      setPlayers(updatedPlayers);
      setField(newField);
      action = { type: "MOVE", id: active.id, row: targetRow, col: targetCol, player: activePlayer };
    }

    if (action) {
      const channel = supabase.channel("team-selector-sync");
      channel.send({ type: "broadcast", event: "drag", payload: action })
        .then(() => console.log("Action broadcasted:", action))
        .catch((err) => console.error("Broadcast error:", err));
    }

    try {
      const { error: saveError } = await supabase.from('layouts').upsert(
        { name: 'live', data: JSON.stringify(newField) },
        { onConflict: 'name' }
      );
      if (saveError) console.error("Upsert failed:", saveError);
      else console.log("Live layout saved to Supabase.");
    } catch (err) {
      console.error("Error saving live layout:", err);
    }

    setActivePlayer(null);
  };

  useEffect(() => {
    const channel = supabase.channel("team-selector-sync");
    channel.on("broadcast", { event: "drag" }, ({ payload }) => {
      const action = payload;
      console.log("Broadcast received:", action);
      if (action.type === "RETURN") {
        setPlayers((prev) => [...prev, action.player]);
        setField((prev) => prev.map(row => row.map(p => (p?.id === action.id ? null : p))));
      } else if (action.type === "MOVE") {
        setPlayers((prev) => prev.filter(p => p.id !== action.id));
        setField((prev) => {
          const updated = prev.map(row => row.map(p => (p?.id === action.id ? null : p)));
          updated[action.row][action.col] = action.player;
          return updated;
        });
      }
    });
    channel.subscribe();

    const fetchLayouts = async () => {
      const { data, error } = await supabase.from('layouts').select('name');
      if (!error && data) setSavedLayouts(data.map(d => d.name));
    };
    fetchLayouts();

    const loadLiveLayout = async () => {
      const { data, error } = await supabase.from('layouts').select('data').eq('name', 'live').single();
      if (error) {
        console.warn("No live layout found or failed to load:", error);
      } else if (data?.data) {
        try {
          const parsed = JSON.parse(data.data);
          setField(parsed);
          console.log("Loaded live layout:", parsed);
        } catch (e) {
          console.error("Error parsing live layout:", e);
        }
      }
    };
    loadLiveLayout();
  }, []);

  return (
    <div className="flex flex-col gap-4 px-2 py-4 w-full max-w-screen-sm mx-auto">
      <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd} collisionDetection={closestCenter}>
        <div className="grid grid-cols-3 gap-2" style={{ rowGap: '0.5rem' }}>
          {field.map((_, rowIndex) => (
            <React.Fragment key={rowIndex}>
              {field[rowIndex].map((player, colIndex) => (
                <DropZone
                  key={`${rowIndex}-${colIndex}`}
                  id={`${rowIndex}-${colIndex}`}
                  player={player}
                  onDoubleClick={handleDoubleClick}
                  isEditing={editingId === player?.id}
                  onChange={handleNameChange}
                  onBlur={handleBlur}
                >
                  {rowIndex === 0 && colIndex === 1 && !player && (<span className="text-sm font-bold">FB</span>)}
                  {rowIndex === 1 && colIndex === 1 && !player && (<span className="text-sm font-bold">HB</span>)}
                  {rowIndex === 2 && colIndex === 1 && !player && (<span className="text-sm font-bold">C</span>)}
                  {rowIndex === 3 && colIndex === 1 && !player && (<span className="text-sm font-bold">HF</span>)}
                  {rowIndex === 4 && colIndex === 1 && !player && (<span className="text-sm font-bold">FF</span>)}
                  {rowIndex === 5 && colIndex === 1 && !player && (<span className="text-sm font-bold">FOL</span>)}
                </DropZone>
              ))}
            </React.Fragment>
          ))}
        </div>

        <div className="overflow-x-auto mt-4">
          <div className="flex flex-row gap-2 py-2">
            <ListDropZone
              players={players}
              onDoubleClick={handleDoubleClick}
              isEditing={editingId}
              onChange={handleNameChange}
              onBlur={handleBlur}
            />
          </div>
        </div>

        <DragOverlay>
          {activePlayer ? <PlayerCard player={activePlayer} editable={false} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function DropZone({ id, player, children, ...rest }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`h-12 w-28 rounded flex items-center justify-center ${id.split('-')[0] >= 6 ? 'bg-yellow-100' : 'bg-red-200'} ${isOver ? "ring-2 ring-blue-400" : ""}`}
    >
      {player ? <PlayerCard player={player} editable={false} {...rest} /> : children}
    </div>
  );
}

function ListDropZone({ players, ...rest }) {
  const { setNodeRef, isOver } = useDroppable({ id: "player-list" });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-row gap-2 overflow-x-auto py-2 ${isOver ? "ring-2 ring-blue-400" : ""}`}
    >
      {players.map((player) => (
        <PlayerCard key={player.id} player={player} {...rest} editable={true} />
      ))}
    </div>
  );
}

function PlayerCard({ player, onDoubleClick, isEditing, onChange, onBlur, editable }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: player.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable && !isDragging) onDoubleClick(player.id);
      }}
      className={`bg-blue-200 p-2 rounded text-center text-xs font-bold h-12 w-24 flex flex-col justify-center items-center touch-none ${isDragging ? "opacity-50" : ""}`}
      style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }}
    >
      {editable && isEditing ? (
        <input
          className="text-center font-bold text-xs w-full bg-white rounded"
          value={player.name}
          onChange={(e) => onChange(player.id, e.target.value)}
          onBlur={onBlur}
          autoFocus
        />
      ) : (
        <>
          {player.number} <br /> {player.name}
        </>
      )}
    </div>
  );
}

const initialPlayers = [
  { id: '6', number: 6, name: 'JENNY' },
  { id: '33', number: 33, name: 'MOLLY' },
  { id: '14', number: 14, name: 'IZZY' },
  { id: '9', number: 9, name: 'INDI' },
  { id: '3', number: 3, name: 'HARPER' },
  { id: '1', number: 1, name: 'AMELIA' },
  { id: '23', number: 23, name: 'SIENNA B' },
  { id: '18', number: 18, name: 'SARAH' },
  { id: '10', number: 10, name: 'AMBRIE' },
  { id: '8', number: 8, name: 'LIV' },
  { id: '15', number: 15, name: 'BRIANNA' },
  { id: '12', number: 12, name: 'ELLA' },
  { id: '16', number: 16, name: 'ROMY' },
  { id: '5', number: 5, name: 'CHLOE' },
  { id: '11', number: 11, name: 'TASIA' },
  { id: '25', number: 25, name: 'MADDIE' },
  { id: '2', number: 2, name: 'RUBY' },
  { id: '4', number: 4, name: 'CHARLOTTE' },
  { id: '13', number: 13, name: 'CHELSEA' },
  { id: '7', number: 7, name: 'ELLIE' },
  { id: '38', number: 38, name: 'SIENNA R' }
];

export default App;

