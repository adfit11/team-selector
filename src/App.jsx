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
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;const SupabaseContext = createContext(null);

function SupabaseProvider({ children }) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  return <SupabaseContext.Provider value={supabase}>{children}</SupabaseContext.Provider>;
}

function useSupabase() {
  return useContext(SupabaseContext);
}

function App() {
  return (
    <SupabaseProvider>
      <TeamLayout />
    </SupabaseProvider>
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

  const handleDragEnd = (event) => {
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
      if (!players.some(p => p.id === active.id)) {
        setPlayers((prev) => [...prev, activePlayer]);
      }
      setField(newField);
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
    setActivePlayer(null);
  };

  useEffect(() => {
    async function fetchLayouts() {
      const { data, error } = await supabase.from('layouts').select('name');
      if (!error && data) setSavedLayouts(data.map(d => d.name));
    }
    fetchLayouts();
  }, []);

  return (
    <>
      <div className="flex flex-row items-center gap-2 px-4 py-2 justify-center max-w-screen-md mx-auto">
        <input
          ref={layoutNameRef}
          type="text"
          placeholder="Layout name"
          list="layout-options"
          className="border px-2 py-1 text-sm rounded w-48"
        />
        <datalist id="layout-options">
          {savedLayouts.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button
          className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 text-sm rounded"
          onClick={async () => {
            const name = layoutNameRef.current?.value?.trim();
            if (!name) return alert("Please enter a layout name.");
            const { data: existing, error: checkError } = await supabase.from('layouts').select('name').eq('name', name);
            if (checkError) return console.error('Check error:', checkError);
            if (existing.length > 0) return alert("A layout with this name already exists. Please choose a different name.");
            const payload = JSON.stringify(field);
            const { error } = await supabase.from('layouts').insert({ name, data: payload });
            if (error) console.error('Save error:', error);
            else console.log('Layout saved:', name);
          }}
        >
          Save
        </button>
        <button
          className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 text-sm rounded"
          onClick={async () => {
            const name = layoutNameRef.current?.value?.trim();
            if (!name) return alert("Please enter a layout name.");
            const { data, error } = await supabase.from('layouts').select('data').eq('name', name).limit(1);
            if (error) console.error('Load error:', error);
            else if (data.length > 0) {
              try {
                setField(JSON.parse(data[0].data));
                console.log("Layout loaded:", name);
              } catch (e) {
                console.error('Parse error:', e);
              }
            }
          }}
        >
          Load
        </button>
      </div>

      <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd} collisionDetection={closestCenter}>
        <div className="flex flex-row p-4 max-w-screen-md mx-auto gap-6">
          <ListDropZone
            players={players}
            onDoubleClick={handleDoubleClick}
            isEditing={editingId}
            onChange={handleNameChange}
            onBlur={handleBlur}
          />

          <div className="grid grid-cols-[repeat(3,auto)_min-content] gap-x-4 items-center" style={{ rowGap: '0.5rem' }}>
            {field.map((row, rowIndex) => (
              <React.Fragment key={rowIndex}>
                {row.map((player, colIndex) => (
                  <DropZone
                    key={`${rowIndex}-${colIndex}`}
                    id={`${rowIndex}-${colIndex}`}
                    player={player}
                    onDoubleClick={handleDoubleClick}
                    isEditing={editingId === player?.id}
                    onChange={handleNameChange}
                    onBlur={handleBlur}
                  />
                ))}
                <div className="text-left font-bold text-sm pl-1 whitespace-nowrap">
                  {`Row ${rowIndex + 1}`}
                </div>
              </React.Fragment>
            ))}
            <div style={{ height: '3rem' }}></div>
          </div>
        </div>
        <DragOverlay>
          {activePlayer ? <PlayerCard player={activePlayer} editable={false} /> : null}
        </DragOverlay>
      </DndContext>
    </>
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
      className={`bg-blue-200 p-2 rounded text-center text-sm font-bold h-12 w-28 flex flex-col justify-center items-center ${isDragging ? "opacity-50" : ""}`}
      style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }}
    >
      {editable && isEditing ? (
        <input
          className="text-center font-bold text-sm w-full bg-white rounded"
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

function DropZone({ id, player, ...rest }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`h-12 w-28 rounded flex items-center justify-center ${id.split('-')[0] >= 6 ? 'bg-yellow-100' : 'bg-red-200'} ${isOver ? "ring-2 ring-blue-400" : ""}`}
    >
      {player ? <PlayerCard player={player} editable={false} {...rest} /> : null}
    </div>
  );
}

function ListDropZone({ players, ...rest }) {
  const { setNodeRef, isOver } = useDroppable({ id: "player-list" });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-4 max-h-screen overflow-y-auto pr-2 ${isOver ? "ring-2 ring-blue-400" : ""}`}
    >
      {players.map((player) => (
        <PlayerCard key={player.id} player={player} {...rest} editable={true} />
      ))}
    </div>
  );
}

const initialPlayers = [
  { id: "1", number: 1, name: "KULIBABA" },
  { id: "3", number: 3, name: "WILD" },
  { id: "6", number: 6, name: "SAWYERS" },
  { id: "9", number: 9, name: "JOHNSTONE" },
  { id: "14", number: 14, name: "BUCHMASSER" },
  { id: "15", number: 15, name: "POGGENPOEL" },
  { id: "18", number: 18, name: "PORTER" },
  { id: "21", number: 21, name: "MARTIN" },
  { id: "23", number: 23, name: "BANDERA" },
  { id: "27", number: 27, name: "NELSON" },
  { id: "30", number: 30, name: "BLAKE" },
  { id: "31", number: 31, name: "WILLIAMS" },
  { id: "33", number: 33, name: "BAKER" },
  { id: "36", number: 36, name: "REED" },
  { id: "38", number: 38, name: "JONES" },
  { id: "39", number: 39, name: "MOSS" },
  { id: "42", number: 42, name: "SMITH" },
  { id: "47", number: 47, name: "BROOKS" },
  { id: "48", number: 48, name: "TURNER" },
  { id: "56", number: 56, name: "ADAMS" },
  { id: "59", number: 59, name: "DAVIS" },
  { id: "60", number: 60, name: "MURPHY" },
  { id: "65", number: 65, name: "THOMAS" },
  { id: "66", number: 66, name: "EVANS" },
  { id: "73", number: 73, name: "HOWARD" },
  { id: "74", number: 74, name: "WALKER" },
  { id: "77", number: 77, name: "COOPER" },
  { id: "84", number: 84, name: "JACKSON" },
  { id: "87", number: 87, name: "LEE" },
  { id: "92", number: 92, name: "CLARKE" }
];

export default App;
