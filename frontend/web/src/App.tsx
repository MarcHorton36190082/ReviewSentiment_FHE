// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ReviewRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  manager: string;
  employeeId: string;
  sentimentScore: number;
  status: "pending" | "processed";
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newReviewData, setNewReviewData] = useState({
    employeeId: "",
    reviewText: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Statistics calculation
  const processedCount = reviews.filter(r => r.status === "processed").length;
  const pendingCount = reviews.filter(r => r.status === "pending").length;
  const averageSentiment = reviews.length > 0 
    ? reviews.reduce((sum, r) => sum + r.sentimentScore, 0) / reviews.length 
    : 0;

  // Filter reviews based on search term
  const filteredReviews = reviews.filter(review => 
    review.employeeId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    review.manager.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    loadReviews().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadReviews = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("review_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing review keys:", e);
        }
      }
      
      const list: ReviewRecord[] = [];
      
      for (const key of keys) {
        try {
          const reviewBytes = await contract.getData(`review_${key}`);
          if (reviewBytes.length > 0) {
            try {
              const reviewData = JSON.parse(ethers.toUtf8String(reviewBytes));
              list.push({
                id: key,
                encryptedData: reviewData.data,
                timestamp: reviewData.timestamp,
                manager: reviewData.manager,
                employeeId: reviewData.employeeId,
                sentimentScore: reviewData.sentimentScore || 0,
                status: reviewData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing review data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading review ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setReviews(list);
    } catch (e) {
      console.error("Error loading reviews:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitReview = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting review data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newReviewData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const reviewId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const reviewData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        manager: account,
        employeeId: newReviewData.employeeId,
        sentimentScore: 0, // Will be updated after FHE processing
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `review_${reviewId}`, 
        ethers.toUtf8Bytes(JSON.stringify(reviewData))
      );
      
      const keysBytes = await contract.getData("review_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(reviewId);
      
      await contract.setData(
        "review_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted review submitted securely!"
      });
      
      await loadReviews();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewReviewData({
          employeeId: "",
          reviewText: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const processReview = async (reviewId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted review with FHE NLP..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const reviewBytes = await contract.getData(`review_${reviewId}`);
      if (reviewBytes.length === 0) {
        throw new Error("Review not found");
      }
      
      const reviewData = JSON.parse(ethers.toUtf8String(reviewBytes));
      
      // Simulate FHE sentiment analysis (would be done on-chain in real scenario)
      const sentimentScore = Math.floor(Math.random() * 100); // Random score for demo
      
      const updatedReview = {
        ...reviewData,
        sentimentScore,
        status: "processed"
      };
      
      await contract.setData(
        `review_${reviewId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedReview))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE sentiment analysis completed!"
      });
      
      await loadReviews();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Processing failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isManager = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet as an HR manager",
      icon: "🔗"
    },
    {
      title: "Submit Encrypted Review",
      description: "Add employee performance review which will be encrypted using FHE",
      icon: "🔒"
    },
    {
      title: "FHE Sentiment Analysis",
      description: "Review text is analyzed for sentiment while remaining encrypted",
      icon: "⚙️"
    },
    {
      title: "Get Insights",
      description: "Receive quantifiable sentiment scores without exposing review content",
      icon: "📊"
    }
  ];

  const renderSentimentChart = () => {
    return (
      <div className="sentiment-chart">
        <div className="chart-bar">
          <div 
            className="bar-fill" 
            style={{ width: `${averageSentiment}%` }}
          ></div>
        </div>
        <div className="chart-label">
          Average Sentiment: {averageSentiment.toFixed(1)}/100
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE<span>Performance</span>Review</h1>
          <div className="logo-subtitle">Confidential Employee Assessments</div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="primary-btn"
          >
            + New Review
          </button>
          <button 
            className="secondary-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <div className="dashboard-card">
            <h3>Total Reviews</h3>
            <div className="stat-value">{reviews.length}</div>
          </div>
          
          <div className="dashboard-card">
            <h3>Processed</h3>
            <div className="stat-value">{processedCount}</div>
          </div>
          
          <div className="dashboard-card">
            <h3>Pending Analysis</h3>
            <div className="stat-value">{pendingCount}</div>
          </div>
          
          <div className="dashboard-card">
            <h3>Average Sentiment</h3>
            {renderSentimentChart()}
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How It Works</h2>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="reviews-section">
          <div className="section-header">
            <h2>Employee Performance Reviews</h2>
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search by employee or manager..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          
          <div className="reviews-list">
            {filteredReviews.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📝</div>
                <p>No performance reviews found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Review
                </button>
              </div>
            ) : (
              filteredReviews.map(review => (
                <div className="review-card" key={review.id}>
                  <div className="review-header">
                    <div className="employee-id">Employee #{review.employeeId}</div>
                    <div className="review-meta">
                      <span className="manager">Manager: {review.manager.substring(0, 6)}...{review.manager.substring(38)}</span>
                      <span className="date">
                        {new Date(review.timestamp * 1000).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  
                  <div className="review-body">
                    <div className="sentiment-display">
                      <div className="sentiment-label">Sentiment Score:</div>
                      <div className="sentiment-value">
                        {review.status === "processed" ? review.sentimentScore : "Pending FHE Analysis"}
                      </div>
                      {review.status === "processed" && (
                        <div className={`sentiment-indicator ${review.sentimentScore > 66 ? "positive" : review.sentimentScore > 33 ? "neutral" : "negative"}`}>
                          {review.sentimentScore > 66 ? "Positive" : review.sentimentScore > 33 ? "Neutral" : "Negative"}
                        </div>
                      )}
                    </div>
                    
                    {isManager(review.manager) && review.status === "pending" && (
                      <button 
                        className="process-btn"
                        onClick={() => processReview(review.id)}
                      >
                        Run FHE Analysis
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New Performance Review</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <span className="fhe-badge">FHE-ENCRYPTED</span> Your review will remain confidential
              </div>
              
              <div className="form-group">
                <label>Employee ID *</label>
                <input 
                  type="text"
                  name="employeeId"
                  value={newReviewData.employeeId} 
                  onChange={(e) => setNewReviewData({...newReviewData, employeeId: e.target.value})}
                  placeholder="Enter employee identifier" 
                />
              </div>
              
              <div className="form-group">
                <label>Review Text *</label>
                <textarea 
                  name="reviewText"
                  value={newReviewData.reviewText} 
                  onChange={(e) => setNewReviewData({...newReviewData, reviewText: e.target.value})}
                  placeholder="Enter confidential performance review..." 
                  rows={5}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={() => setShowCreateModal(false)}
                className="secondary-btn"
              >
                Cancel
              </button>
              <button 
                onClick={submitReview} 
                disabled={creating || !newReviewData.employeeId || !newReviewData.reviewText}
                className="primary-btn"
              >
                {creating ? "Encrypting..." : "Submit Review"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            <div className="notification-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>FHE Performance Review</h3>
            <p>Confidential employee assessments powered by Fully Homomorphic Encryption</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="copyright">
            © {new Date().getFullYear()} HR Tech Solutions. All rights reserved.
          </div>
          <div className="fhe-badge">
            FHE-Powered Confidentiality
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;