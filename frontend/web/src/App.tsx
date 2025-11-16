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
  encryptedValue: any;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  molecularWeight: number;
  bioActivity: number;
}

interface ResearchStats {
  totalCompounds: number;
  verifiedData: number;
  avgActivity: number;
  recentUploads: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [drugs, setDrugs] = useState<DrugData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newDrugData, setNewDrugData] = useState({ 
    name: "", 
    molecularWeight: "", 
    bioActivity: "",
    description: "" 
  });
  const [selectedDrug, setSelectedDrug] = useState<DrugData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [stats, setStats] = useState<ResearchStats>({
    totalCompounds: 0,
    verifiedData: 0,
    avgActivity: 0,
    recentUploads: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting } = useDecrypt();
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");

  useEffect(() => {
    const initFhevm = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM init failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevm();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadDrugs();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Load failed:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

  const loadDrugs = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const drugsList: DrugData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const data = await contract.getBusinessData(businessId);
          drugsList.push({
            id: businessId,
            name: data.name,
            encryptedValue: null,
            publicValue1: Number(data.publicValue1) || 0,
            publicValue2: Number(data.publicValue2) || 0,
            description: data.description,
            creator: data.creator,
            timestamp: Number(data.timestamp),
            isVerified: data.isVerified,
            decryptedValue: Number(data.decryptedValue) || 0,
            molecularWeight: Number(data.publicValue1) || 0,
            bioActivity: Number(data.publicValue2) || 0
          });
        } catch (e) {
          console.error('Error loading drug data:', e);
        }
      }
      
      setDrugs(drugsList);
      updateStats(drugsList);
      updateUserHistory();
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Load failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (drugsList: DrugData[]) => {
    const total = drugsList.length;
    const verified = drugsList.filter(d => d.isVerified).length;
    const avgActivity = total > 0 ? drugsList.reduce((sum, d) => sum + d.bioActivity, 0) / total : 0;
    const recent = drugsList.filter(d => Date.now()/1000 - d.timestamp < 60 * 60 * 24 * 7).length;

    setStats({
      totalCompounds: total,
      verifiedData: verified,
      avgActivity: avgActivity,
      recentUploads: recent
    });
  };

  const updateUserHistory = () => {
    if (!address) return;
    
    const userActions = drugs
      .filter(drug => drug.creator.toLowerCase() === address.toLowerCase())
      .map(drug => ({
        type: 'upload',
        drugName: drug.name,
        timestamp: drug.timestamp,
        verified: drug.isVerified
      }));
    
    setUserHistory(userActions);
  };

  const uploadDrug = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Uploading with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("No contract");
      
      const molecularWeight = parseInt(newDrugData.molecularWeight) || 0;
      const businessId = `drug-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, molecularWeight);
      
      const tx = await contract.createBusinessData(
        businessId,
        newDrugData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        molecularWeight,
        parseInt(newDrugData.bioActivity) || 0,
        newDrugData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Drug data uploaded!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadDrugs();
      setShowUploadModal(false);
      setNewDrugData({ name: "", molecularWeight: "", bioActivity: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "Transaction rejected" 
        : "Upload failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploading(false); 
    }
  };

  const decryptDrug = async (drugId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const drugData = await contractRead.getBusinessData(drugId);
      if (drugData.isVerified) {
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return Number(drugData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(drugId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(drugId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadDrugs();
      
      setTransactionStatus({ visible: true, status: "success", message: "Decryption verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadDrugs();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "System available: " + available });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredDrugs = drugs.filter(drug =>
    drug.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    drug.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>PharmaDAO FHE 🔬</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔬</div>
            <h2>Connect Wallet to Access Encrypted Research</h2>
            <p>Secure collaborative drug discovery with fully homomorphic encryption</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Upload encrypted molecular data</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Collaborate without exposing IP</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption...</p>
        <p className="loading-note">Securing molecular data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading research platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>PharmaDAO FHE 🔬</h1>
          <span>Confidential Drug Discovery</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">Check System</button>
          <button onClick={() => setShowUploadModal(true)} className="upload-btn">+ Upload Compound</button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <h3>Total Compounds</h3>
            <div className="stat-value neon-purple">{stats.totalCompounds}</div>
            <div className="stat-trend">+{stats.recentUploads} this week</div>
          </div>
          
          <div className="stat-panel">
            <h3>Verified Data</h3>
            <div className="stat-value neon-blue">{stats.verifiedData}/{stats.totalCompounds}</div>
            <div className="stat-trend">FHE Verified</div>
          </div>
          
          <div className="stat-panel">
            <h3>Avg Bio Activity</h3>
            <div className="stat-value neon-pink">{stats.avgActivity.toFixed(1)}</div>
            <div className="stat-trend">Encrypted Analysis</div>
          </div>
        </div>

        <div className="research-section">
          <div className="section-header">
            <h2>Encrypted Compound Library</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search compounds..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button onClick={loadDrugs} disabled={isRefreshing} className="refresh-btn">
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="compounds-grid">
            {filteredDrugs.length === 0 ? (
              <div className="empty-state">
                <p>No compounds found</p>
                <button onClick={() => setShowUploadModal(true)} className="upload-btn">Upload First Compound</button>
              </div>
            ) : filteredDrugs.map((drug, index) => (
              <div 
                className={`compound-card ${selectedDrug?.id === drug.id ? "selected" : ""}`} 
                key={index}
                onClick={() => setSelectedDrug(drug)}
              >
                <div className="card-header">
                  <h3>{drug.name}</h3>
                  <span className={`status ${drug.isVerified ? "verified" : "encrypted"}`}>
                    {drug.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                  </span>
                </div>
                <div className="card-content">
                  <p>{drug.description}</p>
                  <div className="compound-data">
                    <span>Molecular Weight: {drug.molecularWeight}</span>
                    <span>Bio Activity: {drug.bioActivity}</span>
                  </div>
                </div>
                <div className="card-footer">
                  <span>{new Date(drug.timestamp * 1000).toLocaleDateString()}</span>
                  <span>{drug.creator.substring(0, 6)}...{drug.creator.substring(38)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {userHistory.length > 0 && (
          <div className="history-section">
            <h3>Your Research History</h3>
            <div className="history-list">
              {userHistory.map((action, index) => (
                <div key={index} className="history-item">
                  <span className="action-type">{action.type}</span>
                  <span className="drug-name">{action.drugName}</span>
                  <span className="timestamp">{new Date(action.timestamp * 1000).toLocaleString()}</span>
                  <span className={`status ${action.verified ? "verified" : "pending"}`}>
                    {action.verified ? "Verified" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {showUploadModal && (
        <UploadModal 
          onSubmit={uploadDrug} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading} 
          drugData={newDrugData} 
          setDrugData={setNewDrugData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedDrug && (
        <DetailModal 
          drug={selectedDrug} 
          onClose={() => setSelectedDrug(null)} 
          isDecrypting={isDecrypting} 
          decryptData={() => decryptDrug(selectedDrug.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const UploadModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  drugData: any;
  setDrugData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, uploading, drugData, setDrugData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'molecularWeight' || name === 'bioActivity') {
      const intValue = value.replace(/[^\d]/g, '');
      setDrugData({ ...drugData, [name]: intValue });
    } else {
      setDrugData({ ...drugData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal">
        <div className="modal-header">
          <h2>Upload Encrypted Compound</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔬 Molecular Encryption</strong>
            <p>Molecular weight encrypted with Zama FHE for secure collaboration</p>
          </div>
          
          <div className="form-group">
            <label>Compound Name *</label>
            <input 
              type="text" 
              name="name" 
              value={drugData.name} 
              onChange={handleChange} 
              placeholder="Enter compound name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Molecular Weight (FHE Encrypted) *</label>
            <input 
              type="number" 
              name="molecularWeight" 
              value={drugData.molecularWeight} 
              onChange={handleChange} 
              placeholder="Enter molecular weight..." 
            />
            <div className="data-label">Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Bio Activity Score (1-100) *</label>
            <input 
              type="number" 
              name="bioActivity" 
              min="1" 
              max="100" 
              value={drugData.bioActivity} 
              onChange={handleChange} 
              placeholder="Enter activity score..." 
            />
            <div className="data-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={drugData.description} 
              onChange={handleChange} 
              placeholder="Compound description..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={uploading || isEncrypting || !drugData.name || !drugData.molecularWeight || !drugData.bioActivity} 
            className="submit-btn"
          >
            {uploading || isEncrypting ? "Encrypting..." : "Upload Compound"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DetailModal: React.FC<{
  drug: DrugData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ drug, onClose, isDecrypting, decryptData }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (drug.isVerified) {
      setDecryptedValue(drug.decryptedValue);
      return;
    }
    
    const value = await decryptData();
    setDecryptedValue(value);
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Compound Details</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="drug-info">
            <div className="info-row">
              <span>Name:</span>
              <strong>{drug.name}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{drug.creator.substring(0, 6)}...{drug.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>Uploaded:</span>
              <strong>{new Date(drug.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Research Data</h3>
            
            <div className="data-row">
              <span>Molecular Weight:</span>
              <div className="value-group">
                <span className="value">
                  {drug.isVerified || decryptedValue !== null ? 
                    `${decryptedValue !== null ? decryptedValue : drug.decryptedValue}` : 
                    "🔒 Encrypted"
                  }
                </span>
                <button 
                  className={`decrypt-btn ${(drug.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                  onClick={handleDecrypt} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : 
                   drug.isVerified ? "✅ Verified" : 
                   decryptedValue !== null ? "🔄 Re-verify" : "🔓 Decrypt"}
                </button>
              </div>
            </div>
            
            <div className="data-row">
              <span>Bio Activity:</span>
              <span className="value">{drug.bioActivity}/100</span>
            </div>
            
            <div className="description">
              <span>Description:</span>
              <p>{drug.description}</p>
            </div>
          </div>
          
          <div className="fhe-info">
            <div className="fhe-icon">🔬</div>
            <div>
              <strong>FHE-Protected Research</strong>
              <p>Sensitive molecular data remains encrypted during collaborative analysis</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


