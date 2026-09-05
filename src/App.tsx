import { useEffect } from 'react';
import { useProjectStore, cleanupStore } from './store/useStore';
import { CatalogTab } from './components/tabs/CatalogTab';
import { GroupsTab } from './components/tabs/GroupsTab';
import { ScriptTab } from './components/tabs/ScriptTab';
import { AudioTab } from './components/tabs/AudioTab';
import { PreviewTab } from './components/tabs/PreviewTab';
import { ProjectTab } from './components/tabs/ProjectTab';
import { TerminalTab } from './components/tabs/TerminalTab';
import { FileImage, FolderTree, FileText, Music, PlaySquare, Settings, Terminal } from 'lucide-react';
import './App.css';

function App() {
  const { 
    currentTab, 
    setCurrentTab, 
    projectName,
    mediaFiles,
    groups,
    edlClips,
    narrationText,
    audioTracks,
    initializeFromDB
  } = useProjectStore();
  
  // Initialize from IndexedDB on mount
  useEffect(() => {
    initializeFromDB();
    
    // Cleanup Object URLs on unmount
    return () => {
      cleanupStore();
    };
  }, [initializeFromDB]);
  
  const tabs = [
    { id: 'catalog', label: 'Catalog', icon: FileImage, disabled: false },
    { id: 'groups', label: 'Groups', icon: FolderTree, disabled: mediaFiles.length === 0 },
    { id: 'script', label: 'Script', icon: FileText, disabled: groups.length === 0 },
    { id: 'audio', label: 'Audio', icon: Music, disabled: edlClips.length === 0 },
    { id: 'preview', label: 'Preview', icon: PlaySquare, disabled: edlClips.length === 0 && narrationText.length === 0 && audioTracks.length === 0 },
    { id: 'project', label: 'Project', icon: Settings, disabled: false },
    { id: 'terminal', label: 'Terminal', icon: Terminal, disabled: false },
  ] as const;
  
  const handleTabClick = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab && !tab.disabled) {
      setCurrentTab(tabId as any);
    }
  };
  
  const renderTab = () => {
    switch (currentTab) {
      case 'catalog':
        return <CatalogTab />;
      case 'groups':
        return <GroupsTab />;
      case 'script':
        return <ScriptTab />;
      case 'audio':
        return <AudioTab />;
      case 'preview':
        return <PreviewTab />;
      case 'project':
        return <ProjectTab />;
      case 'terminal':
        return <TerminalTab />;
      default:
        return <CatalogTab />;
    }
  };
  
  return (
    <div className="app">
      {/* Top Navigation Bar */}
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-logo">VIGNETTE</h1>
          <span className="project-name">{projectName}</span>
        </div>
        
        <nav className="tab-navigation">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                className={`nav-tab ${isActive ? 'active' : ''} ${tab.disabled ? 'disabled' : ''}`}
                onClick={() => handleTabClick(tab.id)}
                title={tab.disabled ? `Complete "${tabs.find((t, i) => i < tabs.findIndex(x => x.id === tab.id) && t.id !== 'project' && t.id !== 'terminal' && !t.disabled)?.label || 'previous steps'}" first` : ''}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </header>
      
      {/* Main Content Area */}
      <main className="app-main">
        {renderTab()}
      </main>
      
      {/* Footer */}
      <footer className="app-footer">
        <p>VIGNETTE - AI-Powered Video Creation Tool</p>
      </footer>
    </div>
  );
}

export default App;
