import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface DrugData {
  id: string;
  name: string;
  moleculeStructure: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [drugs, setDrugs] = useState<DrugData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newDrugData, setNewDrugData] = useState({ 
    name: "", 
    molecule: "", 
    efficacy: "", 
    toxicity: "" 
  });
  const [selectedDrug, setSelectedDrug] = useState<DrugData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    verified: 0,
    avgEfficacy: 0,
    recent: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (isConnected && !isInitialized) {
        try {
          await initialize();
        } catch (error) {
          console.error('FHEVM init failed:', error);
        }
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        const contract = await getContractReadOnly();
        if (!contract) return;
        
        const businessIds = await contract.getAllBusinessIds();
        const drugsList: DrugData[] = [];
        
        for (const id of businessIds) {
          try {
            const data = await contract.getBusinessData(id);
            drugsList.push({
              id,
              name: data.name,
              moleculeStructure: id,
              encryptedValue: id,
              publicValue1: Number(data.publicValue1) || 0,
              publicValue2: Number(data.publicValue2) || 0,
              description: data.description,
              creator: data.creator,
              timestamp: Number(data.timestamp),
              isVerified: data.isVerified,
              decryptedValue: Number(data.decryptedValue) || 0
            });
          } catch (e) {
            console.error('Error loading drug data:', e);
          }
        }
        
        setDrugs(drugsList);
        updateStats(drugsList);
      } catch (e) {
        console.error('Load data failed:', e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

  const updateStats = (drugsList: DrugData[]) => {
    const total = drugsList.length;
    const verified = drugsList.filter(d => d.isVerified).length;
    const avgEfficacy = total > 0 ? drugsList.reduce((sum, d) => sum + d.publicValue1, 0) / total : 0;
    const recent = drugsList.filter(d => Date.now()/1000 - d.timestamp < 604800).length;
    
    setStats({ total, verified, avgEfficacy, recent });
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const drugsList: DrugData[] = [];
      
      for (const id of businessIds) {
        try {
          const data = await contract.getBusinessData(id);
          drugsList.push({
            id,
            name: data.name,
            moleculeStructure: id,
            encryptedValue: id,
            publicValue1: Number(data.publicValue1) || 0,
            publicValue2: Number(data.publicValue2) || 0,
            description: data.description,
            creator: data.creator,
            timestamp: Number(data.timestamp),
            isVerified: data.isVerified,
            decryptedValue: Number(data.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading drug data:', e);
        }
      }
      
      setDrugs(drugsList);
      updateStats(drugsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const uploadDrugData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting molecular data with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not available");
      
      const efficacyValue = parseInt(newDrugData.efficacy) || 0;
      const drugId = `drug-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, efficacyValue);
      
      const tx = await contract.createBusinessData(
        drugId,
        newDrugData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newDrugData.toxicity) || 0,
        0,
        `Molecular: ${newDrugData.molecule}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Storing encrypted data on-chain..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Molecular data encrypted and stored!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowUploadModal(false);
      setNewDrugData({ name: "", molecule: "", efficacy: "", toxicity: "" });
    } catch (e: any) {
      const errorMsg = e.message?.includes("rejected") ? "Transaction rejected" : "Upload failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMsg });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploading(false); 
    }
  };

  const decryptData = async (drugId: string): Promise<number | null> => {
    if (!isConnected || !address) return null;
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const drugData = await contractRead.getBusinessData(drugId);
      if (drugData.isVerified) {
        return Number(drugData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(drugId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractRead.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(drugId, abiEncodedClearValues, decryptionProof)
      );
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadData();
      
      return Number(clearValue);
      
    } catch (e: any) { 
      console.error('Decryption failed:', e);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "FHE system is available" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredDrugs = drugs.filter(drug => {
    const matchesSearch = drug.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         drug.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || drug.isVerified;
    return matchesSearch && matchesFilter;
  });

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔬 PharmaDAO FHE</h1>
            <span>Confidential Drug Discovery</span>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="science-icon">🧪</div>
            <h2>Secure Molecular Research Platform</h2>
            <p>Connect your wallet to access encrypted drug discovery collaboration</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="molecule-spinner"></div>
        <p>Initializing FHE Encryption...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="molecule-spinner"></div>
      <p>Loading encrypted research data...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔬 PharmaDAO FHE</h1>
          <span>分子結構隱私保護平台</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            System Status
          </button>
          <button onClick={() => setShowUploadModal(true)} className="upload-btn">
            + Upload Molecular Data
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="dashboard">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">🧬</div>
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Compounds</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">🔐</div>
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">FHE Verified</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">📈</div>
            <div className="stat-value">{stats.avgEfficacy.toFixed(1)}</div>
            <div className="stat-label">Avg Efficacy</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">🆕</div>
            <div className="stat-value">{stats.recent}</div>
            <div className="stat-label">This Week</div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Search compounds..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="search-icon">🔍</span>
          </div>
          <label className="filter-toggle">
            <input 
              type="checkbox" 
              checked={filterVerified}
              onChange={(e) => setFilterVerified(e.target.checked)}
            />
            Show Verified Only
          </label>
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "🔄" : "↻"} Refresh
          </button>
        </div>

        <div className="drugs-list">
          {filteredDrugs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🧪</div>
              <p>No molecular data found</p>
              <button onClick={() => setShowUploadModal(true)} className="upload-btn">
                Upload First Compound
              </button>
            </div>
          ) : (
            filteredDrugs.map((drug, index) => (
              <div 
                key={index} 
                className={`drug-card ${drug.isVerified ? 'verified' : ''}`}
                onClick={() => setSelectedDrug(drug)}
              >
                <div className="drug-header">
                  <h3>{drug.name}</h3>
                  <span className={`status-badge ${drug.isVerified ? 'verified' : 'encrypted'}`}>
                    {drug.isVerified ? '🔓 Verified' : '🔐 Encrypted'}
                  </span>
                </div>
                <p className="drug-desc">{drug.description}</p>
                <div className="drug-meta">
                  <span>Efficacy: {drug.publicValue1}/10</span>
                  <span>Toxicity: {drug.publicValue2}/10</span>
                  <span>{new Date(drug.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                {drug.isVerified && (
                  <div className="decrypted-value">
                    FHE Decrypted: {drug.decryptedValue}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {showUploadModal && (
        <div className="modal-overlay">
          <div className="upload-modal">
            <div className="modal-header">
              <h2>Upload Molecular Data</h2>
              <button onClick={() => setShowUploadModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="fhe-notice">
                <span>🔐</span>
                <p>Efficacy data will be FHE encrypted. Toxicity remains public for safety.</p>
              </div>
              
              <div className="form-group">
                <label>Compound Name</label>
                <input 
                  type="text" 
                  value={newDrugData.name}
                  onChange={(e) => setNewDrugData({...newDrugData, name: e.target.value})}
                  placeholder="Enter compound name..."
                />
              </div>
              
              <div className="form-group">
                <label>Molecular Structure</label>
                <input 
                  type="text" 
                  value={newDrugData.molecule}
                  onChange={(e) => setNewDrugData({...newDrugData, molecule: e.target.value})}
                  placeholder="Describe molecular structure..."
                />
              </div>
              
              <div className="form-group">
                <label>Efficacy Score (FHE Encrypted)</label>
                <input 
                  type="number" 
                  min="1" 
                  max="10" 
                  value={newDrugData.efficacy}
                  onChange={(e) => setNewDrugData({...newDrugData, efficacy: e.target.value})}
                  placeholder="1-10"
                />
              </div>
              
              <div className="form-group">
                <label>Toxicity Score (Public)</label>
                <input 
                  type="number" 
                  min="1" 
                  max="10" 
                  value={newDrugData.toxicity}
                  onChange={(e) => setNewDrugData({...newDrugData, toxicity: e.target.value})}
                  placeholder="1-10"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowUploadModal(false)}>Cancel</button>
              <button 
                onClick={uploadDrugData} 
                disabled={uploading || isEncrypting}
                className="primary"
              >
                {uploading || isEncrypting ? "Encrypting..." : "Upload Encrypted Data"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedDrug && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Compound Details</h2>
              <button onClick={() => setSelectedDrug(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="detail-section">
                <h3>{selectedDrug.name}</h3>
                <p>{selectedDrug.description}</p>
              </div>
              
              <div className="detail-grid">
                <div className="detail-item">
                  <span>Efficacy Score</span>
                  <strong>{selectedDrug.publicValue1}/10</strong>
                </div>
                <div className="detail-item">
                  <span>Toxicity Score</span>
                  <strong>{selectedDrug.publicValue2}/10</strong>
                </div>
                <div className="detail-item">
                  <span>Status</span>
                  <strong>{selectedDrug.isVerified ? 'FHE Verified' : 'Encrypted'}</strong>
                </div>
                <div className="detail-item">
                  <span>Upload Date</span>
                  <strong>{new Date(selectedDrug.timestamp * 1000).toLocaleDateString()}</strong>
                </div>
              </div>

              {selectedDrug.isVerified && (
                <div className="decrypted-section">
                  <h4>🔓 FHE Decrypted Value</h4>
                  <div className="decrypted-value">{selectedDrug.decryptedValue}</div>
                </div>
              )}

              <div className="action-section">
                <button 
                  onClick={async () => {
                    const result = await decryptData(selectedDrug.id);
                    if (result !== null) {
                      setTransactionStatus({visible: true, status: "success", message: "Decryption successful"});
                      setTimeout(() => setTransactionStatus({visible: false, status: "pending", message: ""}), 2000);
                    }
                  }}
                  disabled={fheIsDecrypting || selectedDrug.isVerified}
                  className="decrypt-btn"
                >
                  {fheIsDecrypting ? "Decrypting..." : selectedDrug.isVerified ? "Already Verified" : "Verify Decryption"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`toast ${transactionStatus.status}`}>
          {transactionStatus.message}
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>🔬 PharmaDAO FHE - Secure Collaborative Drug Discovery</p>
          <div className="footer-links">
            <span>FHE Encrypted</span>
            <span>IP Protected</span>
            <span>Research Collaboration</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;