import { useEffect, useState } from 'react';
import { api } from '../api';
import { KOFI_URL, REPO_URL, openUrl } from '../links';
import { useStore } from '../store';

export function Welcome() {
  const openFolder = useStore((s) => s.openFolder);
  const openPath = useStore((s) => s.openPath);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    void api.invoke('project:recent').then(setRecent);
  }, []);

  return (
    <div className="welcome">
      <h1>Open a rundown</h1>
      <p>
        Pick the folder that holds your <code>GameData_*.json</code> files and{' '}
        <code>PartialData/</code>, for example
        <code> BepInEx\plugins\&lt;YourName&gt; - &lt;Rundown&gt;\&lt;Rundown&gt;</code>.
      </p>
      <button className="primary big" onClick={() => void openFolder()}>
        Open rundown folder…
      </button>
      {recent.length > 0 && (
        <div className="recent">
          <h2>Recent</h2>
          <ul>
            {recent.map((r) => (
              <li key={r}>
                <button className="link" onClick={() => void openPath(r)} title={r}>
                  {r}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="welcome-notes">
        <h2>What it does</h2>
        <ul>
          <li>
            Lists every datablock in your rundown by type, with its name instead of just a number.
          </li>
          <li>
            Finds duplicate IDs, references to blocks that do not exist, missing fields and bad enum
            values.
          </li>
          <li>
            Edits values in typed forms and saves them back without touching your formatting or
            comments.
          </li>
        </ul>
      </div>
      <div className="welcome-foot muted">
        Free and open source:{' '}
        <button className="link" onClick={() => openUrl(REPO_URL)}>
          GitHub
        </button>
        . If it saves you time,{' '}
        <button className="link" onClick={() => openUrl(KOFI_URL)}>
          ☕ buy the developer a coffee
        </button>
        .
      </div>
    </div>
  );
}
