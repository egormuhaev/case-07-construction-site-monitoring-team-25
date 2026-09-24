import hdbscan
from sklearn.cluster import AgglomerativeClustering


def agglomerative_clustering(embeddings, n_clusters: int = 2):
    cluster_model = AgglomerativeClustering(linkage="ward", n_clusters=n_clusters)
    labels = cluster_model.fit_predict(embeddings)
    return labels


def hdbscan_clustering(embeddings):
    cluster_model = hdbscan.HDBSCAN(
        min_cluster_size=4,
        min_samples=10,
        metric="euclidean",
        cluster_selection_epsilon=0.5,
    )
    labels = cluster_model.fit_predict(embeddings)
    return labels


def clustering(embeddings):
    hdbscan = hdbscan_clustering(embeddings)
    return agglomerative_clustering(embeddings, len(set(hdbscan)))
